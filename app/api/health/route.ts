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
  if (readiness.database) {
    const { error } = await getAdminDb().from("system_config").select("key").limit(1);
    databaseReachable = !error;
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
  return NextResponse.json({
    status: ready ? "ready" : "configuration_required",
    ready,
    checks: {
      databaseConfigured: readiness.database,
      databaseReachable,
      stonkPairReady,
      indexerConfigured: readiness.indexer,
      treasuryConfigured: readiness.treasury,
      treasuryRpcReachable,
      treasurySol,
      payoutMode: process.env.PAYOUT_MODE ?? "manual_wallet",
      launchesEnabled: readiness.launchesEnabled,
      dryRun: readiness.dryRun,
    },
    missing: readiness.missing,
  }, { status: ready ? 200 : 503 });
}
