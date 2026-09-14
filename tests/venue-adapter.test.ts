import { afterEach, describe, expect, it, vi } from "vitest";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("StonkFunAdapter", () => {
  it("maps the official prepare payload without inventing fee routing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { signedQuote: "quoted", paymentTransaction: "base64", payment: { lamports: 1 } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new StonkFunAdapter("https://example.test");
    await adapter.createLaunch({ creatorWallet: "wallet", name: "Token", symbol: "TOK", description: "Stored by TopBlast", logo: "data:image/png;base64,AA==", quoteMint: "quote", quoteSymbol: "STONK", feeTier: "1%", allocation: { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 } });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.mode).toBe("standard");
    expect(request).not.toHaveProperty("description");
    expect(request).not.toHaveProperty("topblastPercent");
  });

  it("surfaces an upstream RPC/API failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "service_unavailable", message: "RPC unavailable", retryable: true } }), { status: 503 })));
    await expect(new StonkFunAdapter("https://example.test").getLaunch("sig")).rejects.toMatchObject({ code: "service_unavailable", retryable: true });
  });
});
