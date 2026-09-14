import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";
import type { HeliusEnhancedTransaction } from "@/lib/indexer/helius";

function validSecret(request: Request): boolean {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual || Buffer.byteLength(expected) !== Buffer.byteLength(actual)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

async function persistTransactions(transactions: HeliusEnhancedTransaction[]) {
  const db = getAdminDb();
  const { data: rows, error } = await db.from("tracked_markets").select("launch_id,market_address,base_mint,quote_mint").eq("active", true);
  if (error) throw error;
  const inserts: Record<string, unknown>[] = [];
  for (const transaction of transactions) {
    if (!transaction.signature) continue;
    const serialized = JSON.stringify(transaction);
    for (const row of rows ?? []) {
      if (![row.market_address, row.base_mint, row.quote_mint].some((address) => serialized.includes(address))) continue;
      inserts.push({ launch_id: row.launch_id, signature: transaction.signature, observed_slot: transaction.slot ?? null, payload: transaction, source: "helius_webhook" });
    }
  }
  if (!inserts.length) return 0;
  const { error: insertError } = await db.from("chain_event_inbox").upsert(inserts, { onConflict: "launch_id,signature", ignoreDuplicates: true });
  if (insertError) throw insertError;
  return inserts.length;
}

export async function POST(request: Request) {
  if (!validSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let transactions: HeliusEnhancedTransaction[];
  try { transactions = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(transactions) || transactions.length > 100 || transactions.some((tx) => !tx || typeof tx !== "object")) return NextResponse.json({ error: "Invalid webhook batch" }, { status: 400 });
  // Acknowledge only after the event is durably queued. Finalized RPC verification,
  // deterministic replay, and retry handling happen in the leased worker.
  try {
    const queued = await persistTransactions(transactions);
    return NextResponse.json({ accepted: true, queued });
  } catch {
    return NextResponse.json({ error: "Activity persistence failed. Retry this batch." }, { status: 503 });
  }
}
