import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";
import { runtimeReadiness } from "@/lib/readiness";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";
import { getTreasuryBalance } from "@/lib/solana/rpc";
import { pumpCreationAvailable } from "@/lib/solana/pumpfun";
import { controlledLaunchWallets } from "@/lib/test-launch-access";

export const runtime = "nodejs";

export async function GET() {
  const readiness = runtimeReadiness();
  let databaseReachable = false;
  let stonkPairReady = false;
  let stonkCreationReady = false;
  let stonkCreationError = "Stonk creation configuration has not been verified";
  let treasuryRpcReachable = false;
  let treasurySol: number | null = null;
  let workerFresh = false;
  let enginePaused = true;
  let acceptedCycle = false;
  let pumpSchemaReady = false;
  let pumpPairReady = false;
  if (readiness.database) {
    const { data, error } = await getAdminDb().from("system_config").select("key,value").in("key", ["worker_heartbeat", "reward_engine_paused", "production_acceptance"]);
    databaseReachable = !error;
    const heartbeat = data?.find((row) => row.key === "worker_heartbeat")?.value as { at?: string; pipeline?: string } | undefined;
    workerFresh = Boolean(heartbeat?.at && heartbeat.pipeline === "operational" && Date.now() - new Date(heartbeat.at).getTime() < 180_000);
    enginePaused = data?.find((row) => row.key === "reward_engine_paused")?.value !== false;
    const { count } = await getAdminDb().from("transaction_proofs").select("id", { count: "exact", head: true }).eq("kind", "distribution").not("signature", "is", null);
    // A lone distribution is not evidence of a complete launch-to-restart cycle.
    const acceptance = data?.find((row) => row.key === "production_acceptance")?.value as { verified?: boolean; evidenceUrl?: string; restartVerified?: boolean } | undefined;
    acceptedCycle = (count ?? 0) > 0 && acceptance?.verified === true && acceptance.restartVerified === true && typeof acceptance.evidenceUrl === "string" && acceptance.evidenceUrl.startsWith("https://");
    const pumpSchema = await getAdminDb().from("launch_metadata").select("id").limit(1);
    pumpSchemaReady = !pumpSchema.error;
  }
  try {
    const mint = process.env.STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
    const adapter = new StonkFunAdapter();
    const pair = await adapter.getPair(mint);
    stonkPairReady = Boolean(pair?.launchable && pair.launchLabReady !== false);
    await adapter.getCreationConfig(mint);
    stonkCreationReady = true;
    stonkCreationError = "";
  } catch (error) {
    stonkCreationError = error instanceof Error ? error.message : "Stonk creation configuration unavailable";
  }
  try { pumpPairReady = await pumpCreationAvailable(); } catch { pumpPairReady = false; }
  if (readiness.treasury && process.env.TOPBLAST_TREASURY_ADDRESS) {
    try {
      const balance = await getTreasuryBalance(process.env.TOPBLAST_TREASURY_ADDRESS);
      treasuryRpcReachable = true;
      treasurySol = balance.sol;
    } catch {
      treasuryRpcReachable = false;
    }
  }
  const stonkLaunchReady = readiness.launchReady && databaseReachable && pumpSchemaReady && stonkPairReady && stonkCreationReady && treasuryRpcReachable;
  const pumpEnabled = process.env.PUMPFUN_ENABLED === "true";
  const pumpLaunchReady = readiness.launchReady && databaseReachable && pumpSchemaReady && pumpPairReady && pumpEnabled && treasuryRpcReachable;
  const ready = stonkLaunchReady || pumpLaunchReady;
  const rewardsReady = ready && workerFresh && !enginePaused && !readiness.dryRun && acceptedCycle;
  const rewardBlockers = [!workerFresh && "Operational worker heartbeat", enginePaused && "Reward engine is paused", readiness.dryRun && "DRY_RUN is enabled", !acceptedCycle && "No accepted end-to-end payout proof yet"].filter(Boolean);
  return NextResponse.json({
    status: ready ? "ready" : "configuration_required",
    ready,
    launchReady: ready,
    controlledTesting: !readiness.launchesEnabled && controlledLaunchWallets().length > 0,
    fundingReady: databaseReachable && !readiness.dryRun,
    venues: {
      stonkfun: { launchReady: stonkLaunchReady, pairReady: stonkPairReady, creationReady: stonkCreationReady,
        creationMethod: "stonk_launchlab", rewardAsset: "STONK", fundingMode: "creator_deposit",
        blockers: [...readiness.missing, !readiness.launchesEnabled && "LAUNCHES_ENABLED is false", !databaseReachable && "Database unavailable",
          !pumpSchemaReady && "Launch metadata migration required", !stonkPairReady && "STONK pair unavailable", !stonkCreationReady && stonkCreationError, !treasuryRpcReachable && "Treasury RPC check incomplete"].filter(Boolean) },
      pumpfun: {
        launchReady: pumpLaunchReady, pairReady: pumpPairReady, schemaReady: pumpSchemaReady,
        enabled: pumpEnabled, rewardAsset: "WSOL", fundingMode: "creator_deposit", graduationSupported: false,
        blockers: [
          ...readiness.missing,
          !readiness.launchesEnabled && "LAUNCHES_ENABLED is false",
          !databaseReachable && "Database unavailable",
          !pumpSchemaReady && "Apply 202609150001_pumpfun.sql in Supabase",
          !pumpEnabled && "PUMPFUN_ENABLED is false",
          !pumpPairReady && "Pump.fun mainnet creation unavailable",
          !treasuryRpcReachable && "Treasury RPC check incomplete",
        ].filter(Boolean),
      },
    },
    rewardsReady,
    rewardStatus: acceptedCycle ? rewardsReady ? "operational" : "configured_but_paused" : "acceptance_cycle_required",
    rewardBlockers,
    checks: {
      databaseConfigured: readiness.database,
      databaseReachable,
      stonkPairReady,
      stonkCreationReady,
      stonkCreationError,
      pumpEnabled: process.env.PUMPFUN_ENABLED === "true" && pumpSchemaReady,
      pumpPairReady,
      pumpSchemaReady,
      indexerConfigured: readiness.indexer,
      treasuryConfigured: readiness.treasury,
      treasuryRpcReachable,
      treasurySol,
      payoutMode: process.env.PAYOUT_MODE ?? "manual_wallet",
      launchesEnabled: readiness.launchesEnabled,
      dryRun: readiness.dryRun,
      workerFresh,
      enginePaused,
      acceptedCycle,
    },
    missing: readiness.missing,
  }, { status: ready ? 200 : 503 });
}
