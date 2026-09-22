import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), stonk: vi.fn(), pump: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
vi.mock("@/lib/solana/launchlab", () => ({ observeLaunchLabPrice: mock.stonk }));
vi.mock("@/lib/solana/pumpfun", () => ({ observePumpPrice: mock.pump }));
import { tokenMarketData } from "@/lib/token-market-data";
const market = { venue: "stonkfun", launch_id: "a", market_address: "pool", base_mint: "base", quote_mint: "quote", base_decimals: 6, quote_decimals: 9 };
const pricing = (mint = "quote", time = new Date().toISOString()) => Response.json({ data: { quote: { mint }, prices: { quoteUsd: 0.5, observedAt: time } } });
beforeEach(() => {
  vi.resetAllMocks();
  mock.stonk.mockResolvedValue({ slot: 100, blockTime: new Date().toISOString(), priceQuoteAtomsPerToken: 10000n });
  mock.pump.mockResolvedValue({ slot: 200, blockTime: new Date().toISOString(), priceQuoteAtomsPerToken: 20000n });
  mock.rpc.mockResolvedValue({ value: { amount: "1000000000000000", decimals: 6 } });
  vi.stubGlobal("fetch", vi.fn(async () => pricing()));
});
afterEach(() => vi.unstubAllGlobals());
it("uses verified native reserves, exact supply and a matching USD quote", async () => {
  const result = await tokenMarketData(market);
  expect(result).toMatchObject({ status: "available", priceAtoms: "10000", marketCapQuoteAtoms: "10000000000000", priceUsd: 0.000005, marketCapUsd: 5000 });
  expect(mock.rpc).toHaveBeenCalledWith("getTokenSupply", ["base", { commitment: "finalized", minContextSlot: 100 }]);
});
it.each(["stale", "wrong-mint", "offline"])("keeps native prices but never fabricates USD when conversion is %s", async kind => {
  vi.mocked(fetch).mockImplementation(async () => { if (kind === "offline") throw Error("offline"); return pricing(kind === "wrong-mint" ? "other" : "quote", kind === "stale" ? "2020-01-01T00:00:00Z" : new Date().toISOString()); });
  expect(await tokenMarketData(market)).toMatchObject({ status: "available", priceAtoms: "10000", priceUsd: null, marketCapUsd: null });
});
it("rejects supply decimal mismatch", async () => {
  mock.rpc.mockResolvedValue({ value: { amount: "100", decimals: 9 } });
  expect(await tokenMarketData(market)).toMatchObject({ status: "unavailable" });
});
it("uses the Pump observer only for Pump markets", async () => {
  expect(await tokenMarketData({ ...market, venue: "pumpfun" })).toMatchObject({ priceAtoms: "20000", slot: 200 });
  expect(mock.stonk).not.toHaveBeenCalled();
});
