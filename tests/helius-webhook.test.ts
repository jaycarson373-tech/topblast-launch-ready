import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { addHeliusWebhookAddresses } from "@/lib/indexer/helius-webhook";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HELIUS_API_KEY;
  delete process.env.HELIUS_WEBHOOK_ID;
  delete process.env.HELIUS_WEBHOOK_SECRET;
  delete process.env.TOPBLAST_TREASURY_ADDRESS;
});

describe("Helius webhook registration", () => {
  it("preserves existing addresses and adds a launch exactly once", async () => {
    process.env.HELIUS_API_KEY = "key";
    process.env.HELIUS_WEBHOOK_ID = "webhook-id";
    process.env.HELIUS_WEBHOOK_SECRET = "secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ webhookID: "webhook-id", webhookURL: "https://example.com/api/indexer/helius", transactionTypes: ["ANY"], accountAddresses: ["existing"], webhookType: "enhanced" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await addHeliusWebhookAddresses(["mint", "pool", "mint"]);
    const update = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(update.accountAddresses).toEqual(["existing", "mint", "pool"]);
    expect(update.authHeader).toBe("Bearer secret");
  });

  it("does not update an already registered launch", async () => {
    process.env.HELIUS_API_KEY = "key";
    process.env.HELIUS_WEBHOOK_ID = "webhook-id";
    process.env.HELIUS_WEBHOOK_SECRET = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ webhookID: "webhook-id", webhookURL: "https://example.com", transactionTypes: ["ANY"], accountAddresses: ["mint", "pool"], webhookType: "enhanced" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await addHeliusWebhookAddresses(["mint", "pool"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("automatically registers the configured reward treasury", async () => {
    process.env.HELIUS_API_KEY = "key";
    process.env.HELIUS_WEBHOOK_ID = "webhook-id";
    process.env.HELIUS_WEBHOOK_SECRET = "secret";
    process.env.TOPBLAST_TREASURY_ADDRESS = "treasury";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ webhookID: "webhook-id", webhookURL: "https://example.com/api/indexer/helius", transactionTypes: ["ANY"], accountAddresses: ["bootstrap"], webhookType: "enhanced" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await addHeliusWebhookAddresses(["mint", "pool"]);
    const update = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(update.accountAddresses).toEqual(["bootstrap", "mint", "pool", "treasury"]);
  });
});
