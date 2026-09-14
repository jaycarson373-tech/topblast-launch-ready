import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";
import { parseHeliusActivity, type HeliusEnhancedTransaction } from "@/lib/indexer/helius";

function validSecret(request: Request): boolean {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

async function processTransactions(transactions: HeliusEnhancedTransaction[]) {
  const db = getAdminDb();
  const { data: rows, error } = await db.from("tracked_markets").select("*").eq("active", true);
  if (error) throw error;
  for (const row of rows ?? []) {
    const market = { launchId: row.launch_id, baseMint: row.base_mint, quoteMint: row.quote_mint, marketAddress: row.market_address, venue: "stonkfun" as const, tokenDecimals: row.base_decimals, quoteDecimals: row.quote_decimals };
    let lastSlot = BigInt(row.last_indexed_slot ?? 0);
    for (const transaction of transactions) {
      const parsed = parseHeliusActivity(transaction, market);
      if (!parsed) continue;
      if (transaction.slot !== undefined && BigInt(transaction.slot) > lastSlot) lastSlot = BigInt(transaction.slot);
      for (let index = 0; index < parsed.events.length; index += 1) {
        const event = parsed.events[index];
        const { error: applyError } = await db.rpc("apply_wallet_activity", {
          p_launch_id: event.launchId, p_wallet: event.wallet, p_signature: parsed.signature,
          p_event_index: index, p_kind: event.kind, p_token_raw: event.tokenRaw.toString(),
          p_quote_atoms: event.kind === "verified_buy" ? event.quoteAtoms.toString() : null,
          p_slot: event.slot.toString(),
        });
        if (applyError) throw applyError;
      }
    }
    if (lastSlot > BigInt(row.last_indexed_slot ?? 0)) {
      const { error: updateError } = await db.from("tracked_markets").update({ last_indexed_slot: lastSlot.toString(), updated_at: new Date().toISOString() }).eq("launch_id", row.launch_id);
      if (updateError) throw updateError;
    }
  }
}

export async function POST(request: Request) {
  if (!validSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const transactions = await request.json() as HeliusEnhancedTransaction[];
  if (!Array.isArray(transactions) || transactions.length > 100) return NextResponse.json({ error: "Invalid webhook batch" }, { status: 400 });
  after(async () => {
    try { await processTransactions(transactions); }
    catch (error) { console.error("Helius webhook processing failed", error instanceof Error ? error.message : "unknown error"); }
  });
  return NextResponse.json({ accepted: true });
}
