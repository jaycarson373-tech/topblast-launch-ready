import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";

function authorized(request: Request) {
  const expected = process.env.ADMIN_API_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminDb();
  const [launches, markets, failedEpochs, failedPayouts, fees, config] = await Promise.all([
    db.from("launches").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("tracked_markets").select("last_indexed_slot,updated_at").eq("active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("reward_epochs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("reward_distributions").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("fee_events").select("amount_atoms").in("status", ["detected", "confirmed"]),
    db.from("system_config").select("key,value"),
  ]);
  const unclaimed = (fees.data ?? []).reduce((sum, item) => sum + BigInt(item.amount_atoms), 0n);
  return NextResponse.json({ activeLaunches: launches.count ?? 0, trackerHealth: markets.data ? "ONLINE" : "NO MARKETS", lastIndexedBlock: markets.data?.last_indexed_slot ?? null, failedEpochs: failedEpochs.count ?? 0, failedPayouts: failedPayouts.count ?? 0, unclaimedFeesAtoms: unclaimed.toString(), treasuryBalances: "RPC balance monitor not configured", config: config.data ?? [] });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { action?: string; launchId?: string; epochId?: string };
  const db = getAdminDb();
  if (body.action === "pause_engine") {
    const { error } = await db.from("system_config").upsert({ key: "reward_engine_paused", value: true, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "pause_launch" && body.launchId) {
    const { error } = await db.from("launches").update({ status: "paused" }).eq("id", body.launchId).eq("status", "active");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "retry_epoch" && body.epochId) {
    const { error } = await db.from("reward_epochs").update({ status: "pending", failed_step: null, failure_message: null }).eq("id", body.epochId).eq("status", "failed");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "dry_run_payout" && body.epochId) {
    const { data, error } = await db.from("reward_allocations").select("wallet,amount_atoms").eq("epoch_id", body.epochId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const total = (data ?? []).reduce((sum, row) => sum + BigInt(row.amount_atoms), 0n);
    return NextResponse.json({ ok: true, dryRun: true, wallets: data?.length ?? 0, totalAtoms: total.toString(), note: "No transaction created or signed" });
  }
  return NextResponse.json({ error: "Unsupported admin action" }, { status: 400 });
}
