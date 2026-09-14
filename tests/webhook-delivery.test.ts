import { afterEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ select: () => ({ eq: query }) }) }) }));
import { POST } from "@/app/api/indexer/helius/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const request = () => new Request("http://localhost/api/indexer/helius", { method: "POST", headers: { authorization: "Bearer secret" }, body: "[]" });
describe("webhook delivery acknowledgment", () => {
  it("returns 503 when persistence fails so the provider can retry", async () => {
    vi.stubEnv("HELIUS_WEBHOOK_SECRET", "secret"); query.mockResolvedValue({ data: null, error: new Error("database offline") });
    expect((await POST(request())).status).toBe(503);
  });
  it("acknowledges successfully processed batches", async () => {
    vi.stubEnv("HELIUS_WEBHOOK_SECRET", "secret"); query.mockResolvedValue({ data: [], error: null });
    expect((await POST(request())).status).toBe(200);
  });
  it("rejects unauthorized delivery without touching the database", async () => {
    vi.stubEnv("HELIUS_WEBHOOK_SECRET", "another");
    expect((await POST(request())).status).toBe(401); expect(query).not.toHaveBeenCalled();
  });
});
