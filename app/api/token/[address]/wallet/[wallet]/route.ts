import { NextResponse } from "next/server";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";
import { isAddress } from "@solana/addresses";

export async function GET(_request: Request, context: { params: Promise<{ address: string; wallet: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const { address, wallet } = await context.params;
  if (!isAddress(wallet) || !isAddress(address)) return NextResponse.json({ error: "Enter a valid Solana wallet address" }, { status: 400 });
  const db = getAdminDb();
  const { data: launch } = await db.from("launches").select("id,price_usd").eq("mint", address).eq("listing_hidden", false).or("is_test.eq.false,public_test_listing.eq.true").in("status", ["active", "paused"]).single();
  if (!launch) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  const [{ data: position }, { data: snapshot }, { data: rewards }] = await Promise.all([
    db.from("wallet_positions").select("*").eq("launch_id", launch.id).eq("wallet", wallet).maybeSingle(),
    db.from("reward_snapshots").select("*").eq("launch_id", launch.id).eq("wallet", wallet).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("reward_distributions").select("amount_atoms").eq("launch_id", launch.id).eq("wallet", wallet).eq("status", "confirmed"),
  ]);
  const { data: market, error: marketError } = await db.from("tracked_markets").select("history_complete").eq("launch_id", launch.id).maybeSingle();
  if (marketError) return NextResponse.json({ error: "History verification is unavailable" }, { status: 503 });
  if (!position) return NextResponse.json({ wallet, status: market?.history_complete ? "NOT_A_VERIFIED_BUYER" : "INSUFFICIENT_HISTORY", averageEntry: null, currentValue: null, drawdown: null, eligibleUnits: "0", rewardsReceived: "0" });
  const received = (rewards ?? []).reduce((sum, row) => sum + BigInt(row.amount_atoms), 0n);
  return NextResponse.json({
    wallet, status: market?.history_complete ? snapshot?.status ?? "INSUFFICIENT_HISTORY" : "INSUFFICIENT_HISTORY",
    averageEntry: snapshot?.average_entry_quote_atoms ?? null,
    currentValue: snapshot?.current_value_quote_atoms ?? null,
    drawdown: snapshot?.eligible_loss_quote_atoms ?? null,
    eligibleUnits: snapshot?.eligible_units_raw ?? "0", rewardsReceived: received.toString(),
  });
}
