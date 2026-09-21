import { afterEach, describe, expect, it, vi } from "vitest";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";
const mock = vi.hoisted(() => ({ verify: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/solana/stonk-launchlab", () => ({ verifyStonkPricing: mock.verify, prepareStonkLaunch: mock.prepare, isStonkDirectQuote: () => false }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }));

afterEach(() => vi.unstubAllGlobals());

describe("StonkFunAdapter", () => {
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
