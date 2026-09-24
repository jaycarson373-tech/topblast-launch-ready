import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), price: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
vi.mock("@/lib/solana/launchlab", () => ({ observeLaunchLabPrice: mock.price }));
import { reconcileMarket } from "@/lib/worker/pipeline";
import * as decoder from "@/lib/indexer/launchlab-decoder";
const market = { venue: "stonkfun", launch_id: "a", base_mint: "base", quote_mint: "quote", market_address: "pool", base_decimals: 6, quote_decimals: 9, launch_slot: 100, last_indexed_slot: 99, creator_address: "creator", authority_address: "authority", config_address: "config", platform_config_address: "platform", base_vault: "base-vault", quote_vault: "quote-vault", history_complete: false, price_status: "failed", base_token_program: "token", quote_token_program: "token" };
const irrelevant = { version: 1, meta: { err: null }, transaction: { signatures: ["other"], message: { accountKeys: [{ pubkey: "unrelated", signer: true }], instructions: [], transactionConfig: { priorityFee: 100 } } } };
function database() {
  const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
  const db = { rpc: vi.fn(async () => ({ data: true, error: null })), from: (table: string) => {
    const chain = { eq: () => chain, lte: () => chain, in: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return { update: (values: Record<string, unknown>) => { writes.push({ table, values }); return chain; }, upsert: (values: Record<string, unknown>) => { writes.push({ table, values }); return Promise.resolve({ error: null }); } };
  } };
  return { db: db as unknown as SupabaseClient, writes };
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mock.price.mockResolvedValue({ slot: 100, blockTime: new Date().toISOString(), priceQuoteAtomsPerToken: 42n });
  mock.rpc.mockImplementation(async (method: string, args: unknown[]) => {
    if (method === "getSlot") return 101;
    if (method === "getBlocks") return [100, 101];
    if (method === "getBlock") return { blockhash: `hash-${args[0]}`, previousBlockhash: `hash-${Number(args[0]) - 1}`, blockTime: 123, transactions: [irrelevant] };
    throw Error(method);
  });
});
describe("finalized market reconciliation", () => {
  it("sends the launch transaction through the verified decoder so an atomic dev buy is not skipped", async () => {
    const decode = vi.spyOn(decoder, "decodeFinalizedLaunchLabTransaction");
    const { db } = database();
    await reconcileMarket(db, { ...market, launch_signature: "other" }, "worker");
    expect(decode).toHaveBeenCalledTimes(2);
    // This fixture has no swap. Passing it to the decoder must not fabricate one.
    expect(db.rpc).not.toHaveBeenCalledWith("apply_wallet_activity", expect.anything());
  });
  it("accepts parsed v1 blocks, keeps finality and checkpoints every completed block", async () => {
    const { db, writes } = database();
    expect(await reconcileMarket(db, market, "worker")).toBe(true);
    expect(mock.rpc).toHaveBeenCalledWith("getBlock", [100, expect.objectContaining({ encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 1 })]);
    expect(writes[0].table).toBe("price_observations");
    expect(writes.filter(w => w.table === "tracked_markets").map(w => w.values.last_indexed_slot)).toEqual([100, 101, 101]);
    expect(writes.at(-1)?.values.history_complete).toBe(true);
  });
  it("retains price and completed-block progress without skipping an unavailable block", async () => {
    const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (...args) => args[0] === "getBlock" && args[1][0] === 101 ? null : original(...args));
    const { db, writes } = database();
    await expect(reconcileMarket(db, market, "worker")).rejects.toThrow("101 is unavailable");
    expect(writes[0].table).toBe("price_observations");
    expect(writes.at(-1)?.values).toMatchObject({ last_indexed_slot: 100, history_complete: false });
  });
  it("never skips a broken blockhash link", async () => {
    const { db } = database();
    await expect(reconcileMarket(db, { ...market, last_indexed_blockhash: "wrong" }, "worker")).rejects.toThrow("continuity");
  });
});
