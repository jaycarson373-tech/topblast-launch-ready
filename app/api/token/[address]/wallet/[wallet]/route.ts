import { NextResponse } from "next/server";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

export async function GET(_request: Request, context: { params: Promise<{ address: string; wallet: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const { address, wallet } = await context.params;
  const db = getAdminDb();
  const { data: launch } = await db.from("launches").select("id,price_usd").eq("mint", address).eq("is_test", false).single();
  if (!launch) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  const [{ data: position }, { data: snapshot }, { data: rewards }] = await Promise.all([
    db.from("wallet_positions").select("*").eq("launch_id", launch.id).eq("wallet", wallet).maybeSingle(),
    db.from("reward_snapshots").select("*").eq("launch_id", launch.id).eq("wallet", wallet).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("reward_distributions").select("amount_atoms").eq("launch_id", launch.id).eq("wallet", wallet).eq("status", "confirmed"),
  ]);
  if (!position) return NextResponse.json({ wallet, status: "NOT_A_VERIFIED_BUYER", averageEntry: null, currentValue: null, drawdown: null, eligibleUnits: "0", rewardsReceived: "0" });
  const received = (rewards ?? []).reduce((sum, row) => sum + BigInt(row.amount_atoms), 0n);
  return NextResponse.json({
    wallet, status: snapshot?.status ?? "INSUFFICIENT_HISTORY",
    averageEntry: snapshot?.average_entry_quote_atoms ?? null,
    currentValue: snapshot?.current_value_quote_atoms ?? null,
    drawdown: snapshot?.eligible_loss_quote_atoms ?? null,
    eligibleUnits: snapshot?.eligible_units_raw ?? "0", rewardsReceived: received.toString(),
  });
}
