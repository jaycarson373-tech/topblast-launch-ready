import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";
import { runtimeReadiness } from "@/lib/readiness";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";
import { getTreasuryBalance } from "@/lib/solana/rpc";

export const runtime = "nodejs";

export async function GET() {
  const readiness = runtimeReadiness();
  let databaseReachable = false;
  let stonkPairReady = false;
  let treasuryRpcReachable = false;
  let treasurySol: number | null = null;
  let workerFresh = false;
  let enginePaused = true;
  let acceptedCycle = false;
  let pumpSchemaReady = false;
  if (readiness.database) {
    const { data, error } = await getAdminDb().from("system_config").select("key,value").in("key", ["worker_heartbeat", "reward_engine_paused"]);
    databaseReachable = !error;
    const heartbeat = data?.find((row) => row.key === "worker_heartbeat")?.value as { at?: string; pipeline?: string } | undefined;
    workerFresh = Boolean(heartbeat?.at && heartbeat.pipeline === "operational" && Date.now() - new Date(heartbeat.at).getTime() < 180_000);
    enginePaused = data?.find((row) => row.key === "reward_engine_paused")?.value !== false;
    const { count } = await getAdminDb().from("transaction_proofs").select("id", { count: "exact", head: true }).eq("kind", "distribution").not("signature", "is", null);
    acceptedCycle = (count ?? 0) > 0;
    const pumpSchema = await getAdminDb().from("launch_metadata").select("id").limit(1);
    pumpSchemaReady = !pumpSchema.error;
  }
  try {
    const mint = process.env.STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
    const pair = await new StonkFunAdapter().getPair(mint);
    stonkPairReady = Boolean(pair?.launchable && pair.launchLabReady !== false);
  } catch {
    stonkPairReady = false;
  }
  if (readiness.treasury && process.env.TOPBLAST_TREASURY_ADDRESS) {
    try {
      const balance = await getTreasuryBalance(process.env.TOPBLAST_TREASURY_ADDRESS);
      treasuryRpcReachable = true;
      treasurySol = balance.sol;
    } catch {
      treasuryRpcReachable = false;
    }
  }
  const ready = readiness.launchReady && databaseReachable && stonkPairReady && treasuryRpcReachable;
  const rewardsReady = ready && workerFresh && !enginePaused && !readiness.dryRun && acceptedCycle;
  const rewardBlockers = [!workerFresh && "Operational worker heartbeat", enginePaused && "Reward engine is paused", readiness.dryRun && "DRY_RUN is enabled", !acceptedCycle && "No accepted end-to-end payout proof yet"].filter(Boolean);
  return NextResponse.json({
    status: ready ? "ready" : "configuration_required",
    ready,
    launchReady: ready,
    rewardsReady,
    rewardStatus: acceptedCycle ? rewardsReady ? "operational" : "configured_but_paused" : "acceptance_cycle_required",
    rewardBlockers,
    checks: {
      databaseConfigured: readiness.database,
      databaseReachable,
      stonkPairReady,
      pumpEnabled: process.env.PUMPFUN_ENABLED === "true" && pumpSchemaReady,
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
