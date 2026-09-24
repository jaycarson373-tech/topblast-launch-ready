import { afterEach, describe, expect, it, vi } from "vitest";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";
const mock = vi.hoisted(() => ({ verify: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/solana/stonk-launchlab", () => ({ verifyStonkPricing: mock.verify, prepareStonkLaunch: mock.prepare, isStonkDirectQuote: () => false }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }));

afterEach(() => vi.unstubAllGlobals());

describe("StonkFunAdapter", () => {
  it("labels Stonk forwarding totals as creator-wide diagnostics, never launch funding", async () => {
    const creator = "AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42";
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { creator, claimable: null } }))
      .mockResolvedValueOnce(Response.json({ eligible: true, creator, payout: { mode: "forwarded", quoteMint: "So11111111111111111111111111111111111111112", quoteSymbol: "SOL", decimals: 9, accruedRaw: "841744", forwardedRaw: "123000000", pendingRaw: "841744", minForwardUsd: 5 } }));
    vi.stubGlobal("fetch", fetchMock);
    const fees = await new StonkFunAdapter("https://example.test/api/public/v1").getCreatorFees("mint");
    expect(fees.forwarding).toMatchObject({ tokenAccruedAtoms: "841744", creatorQuoteForwardedAtoms: "123000000", minimumForwardUsd: 5, attribution: "creator_quote_aggregate_not_launch_funding" });
    expect(fees.claimable).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe(`https://example.test/api/creator-fees?mint=mint&wallet=${creator}`);
  });
  it("keeps the public fee response usable if forwarding diagnostics fail", async () => {
    const creator = "AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: { creator, claimable: null, reason: "Forwarded by venue" } })).mockResolvedValueOnce(Response.json({}, { status: 503 })));
    const fees = await new StonkFunAdapter().getCreatorFees("mint");
    expect(fees.reason).toBe("Forwarded by venue"); expect(fees.forwarding).toBeUndefined(); expect(fees.forwardingError).toContain("could not be verified");
  });
  it("rejects another creator's forwarding summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: { creator: "AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42", claimable: null } })).mockResolvedValueOnce(Response.json({ eligible: true, creator: "11111111111111111111111111111111", payout: {} })));
    const fees = await new StonkFunAdapter().getCreatorFees("mint");
    expect(fees.forwarding).toBeUndefined(); expect(fees.forwardingError).toBeTruthy();
  });
  it("uses Stonk's replacement pricing API, never the retired payment prepare endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { curve: "fixture" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new StonkFunAdapter("https://example.test");
    await adapter.createLaunch({ creatorWallet: "wallet", name: "Token", symbol: "TOK", description: "Stored by TopBlast", logo: "data:image/png;base64,AA==", quoteMint: "quote", quoteSymbol: "STONK", feeTier: "1%", allocation: { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/launchlab/pricing?quoteMint=quote");
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(mock.verify).toHaveBeenCalledWith({ curve: "fixture" }, "quote");
    expect(mock.prepare).toHaveBeenCalled();
  });

  it("surfaces an upstream RPC/API failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "service_unavailable", message: "RPC unavailable", retryable: true } }), { status: 503 })));
    await expect(new StonkFunAdapter("https://example.test").getLaunch("sig")).rejects.toMatchObject({ code: "service_unavailable", retryable: true });
  });
  it("respects an explicitly non-retryable upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "service_unavailable", message: "Disabled", retryable: false } }), { status: 503 })));
    await expect(new StonkFunAdapter().getCreationConfig("quote")).rejects.toMatchObject({ retryable: false });
  });
});

describe("launch outcome integrity", () => {
  it("does not convert a failed launch into completed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: "failed", paymentSignature: "sig" } }))));
    expect((await new StonkFunAdapter().getLaunch("sig")).status).toBe("failed");
  });
  it.each([{}, { status: "unexpected" }, { status: "completed", mint: "mint" }])("rejects incomplete or unknown success responses: %j", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }))));
    await expect(new StonkFunAdapter().getLaunch("sig")).rejects.toMatchObject({ code: "invalid_response" });
  });
});
