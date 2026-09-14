import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";
import { parseHeliusActivity, type HeliusEnhancedTransaction } from "@/lib/indexer/helius";

function validSecret(request: Request): boolean {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !actual || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function POST(request: Request) {
  if (!validSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const transactions = await request.json() as HeliusEnhancedTransaction[];
  const db = getAdminDb();
  const { data: rows, error } = await db.from("tracked_markets").select("*").eq("active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let applied = 0;
  for (const row of rows ?? []) {
    const market = { launchId: row.launch_id, baseMint: row.base_mint, quoteMint: row.quote_mint, marketAddress: row.market_address, venue: "stonkfun" as const, tokenDecimals: row.base_decimals, quoteDecimals: row.quote_decimals };
    for (const transaction of transactions) {
      const parsed = parseHeliusActivity(transaction, market);
      if (!parsed) continue;
      for (let index = 0; index < parsed.events.length; index += 1) {
        const event = parsed.events[index];
        const { error: applyError } = await db.rpc("apply_wallet_activity", {
          p_launch_id: event.launchId, p_wallet: event.wallet, p_signature: parsed.signature,
          p_event_index: index, p_kind: event.kind, p_token_raw: event.tokenRaw.toString(),
          p_quote_atoms: event.kind === "verified_buy" ? event.quoteAtoms.toString() : null,
          p_slot: event.slot.toString(),
        });
        if (applyError) return NextResponse.json({ error: applyError.message }, { status: 500 });
        applied += 1;
      }
    }
  }
  return NextResponse.json({ accepted: true, applied });
}
