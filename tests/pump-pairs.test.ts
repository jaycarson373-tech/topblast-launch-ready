import { afterEach, describe, expect, it, vi } from "vitest";
import { listOfficialPumpPairs, officialPumpPair } from "@/lib/venue/pump-pairs";
import { PUMP_SOL_MINT } from "@/lib/solana/pumpfun";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const html = `<table><tr><th>Symbol</th></tr>
<tr><td>SOL</td><td>Solana</td><td>native</td><td>native</td><td>${PUMP_SOL_MINT}</td></tr>
<tr><td>USDC</td><td>USD Coin</td><td>Circle</td><td>native</td><td>${USDC}</td></tr>
<tr><td>BAD</td><td>Bad row</td><td>x</td><td>x</td><td>not-a-mint</td></tr></table>`;

afterEach(() => vi.restoreAllMocks());

describe("Pump.fun official pair catalog", () => {
  it("parses only validated public keys and preserves SOL first", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html, { status: 200 })));
    const pairs = await listOfficialPumpPairs();
    expect(pairs.map((pair) => [pair.symbol, pair.mint])).toEqual([["SOL", PUMP_SOL_MINT], ["USDC", USDC]]);
    expect(pairs.every((pair) => pair.launchable)).toBe(true);
  });

  it("keeps SOL usable without trusting a remote catalog response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await officialPumpPair(PUMP_SOL_MINT)).toMatchObject({ symbol: "SOL", mint: PUMP_SOL_MINT, decimals: 9 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed on an incomplete remote catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    await expect(listOfficialPumpPairs()).rejects.toThrow("incomplete supported-pair catalog");
  });
});

