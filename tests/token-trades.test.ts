import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), stonk: vi.fn(), pump: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
vi.mock("@/lib/indexer/launchlab-decoder", () => ({ decodeFinalizedLaunchLabTransaction: mock.stonk }));
vi.mock("@/lib/indexer/pumpfun-decoder", () => ({ decodeFinalizedPumpTransaction: mock.pump }));
import { recentTokenTrades, mergeTokenTrades, type PublicTrade } from "@/lib/token-trades";
let launch = 0;
const market = () => ({ launch_id: `launch-${launch++}`, market_address: "pool", base_mint: "base", quote_mint: "quote", launch_slot: 100, launch_signature: "creation" });
beforeEach(() => {
  vi.resetAllMocks();
  mock.rpc.mockImplementation(async (method, args) => method === "getSignaturesForAddress" ? [{ signature: "buy", slot: 101, err: null }, { signature: "buy", slot: 101, err: null }, { signature: "failed", slot: 102, err: {} }, { signature: "creation", slot: 100, err: null }, { signature: "old", slot: 99, err: null }] : { slot: 101, blockTime: 1790078400, transaction: { signatures: [args[0]] } });
  mock.stonk.mockReturnValue({ signature: "buy", events: [{ kind: "verified_buy", wallet: "buyer", tokenRaw: 123456789012345678n, quoteAtoms: 99n }, { kind: "incoming_transfer", wallet: "recipient", tokenRaw: 1n }] });
});
it("filters failed, duplicate, pre-launch and creation signatures and ordinary transfers", async () => {
  const row = market();
  const result = await recentTokenTrades(row);
  expect(result).toMatchObject({ available: true, partial: false });
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0]).toMatchObject({ token_raw: "123456789012345678", quote_atoms: "99", slot: 101 });
  expect(mock.rpc).toHaveBeenCalledWith("getTransaction", ["buy", { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
  expect(mock.stonk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ launchId: row.launch_id, marketAddress: "pool", baseMint: "base" }), 101n);
});
it("excludes unverifiable receipts and explicitly marks the feed incomplete", async () => {
  mock.stonk.mockImplementation(() => { throw Error("market identity mismatch"); });
  expect(await recentTokenTrades(market())).toEqual({ available: true, partial: true, trades: [] });
});
it("rejects an RPC receipt whose signature or slot does not match", async () => {
  const original = mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation(async (...args) => args[0] === "getTransaction" ? { slot: 102, transaction: { signatures: ["other"] } } : original(...args));
  expect((await recentTokenTrades(market())).trades).toEqual([]);
  expect(mock.stonk).not.toHaveBeenCalled();
});
it("caches reads briefly but isolates the same market query by launch", async () => {
  const row = market();
  await recentTokenTrades(row); await recentTokenTrades(row);
  expect(mock.stonk).toHaveBeenCalledTimes(1);
  await recentTokenTrades(market());
  expect(mock.stonk).toHaveBeenCalledTimes(2);
});
it("deduplicates receipts already in indexed history without inventing sell proceeds", () => {
  const trade: PublicTrade = { id: "a", signature: "sig", wallet: "buyer", kind: "sell", token_raw: "10", quote_atoms: null, slot: 100, block_time: null };
  expect(mergeTokenTrades([trade], [{ ...trade, id: "live" }])).toEqual([{ ...trade, id: "live" }]);
});
it("publishes exact sell proceeds when the verified venue decoder provides them", async () => {
  mock.stonk.mockReturnValue({ signature: "buy", events: [{ kind: "sell", wallet: "seller", tokenRaw: 50n, quoteAtoms: 25n }] });
  expect((await recentTokenTrades(market())).trades[0]).toMatchObject({ kind: "sell", quote_atoms: "25" });
});
