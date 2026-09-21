import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock("@/lib/test-launch-readiness", () => ({ assertTestLaunchReady: async () => undefined }));
vi.mock("@/app/api/health/route", () => ({ GET: mocks.health }));
import { GET } from "@/app/api/launch/test-readiness/route";
beforeEach(() => vi.stubEnv("ADMIN_API_TOKEN", "fixture-token"));
afterEach(() => vi.unstubAllEnvs());
it("never treats pair availability as Stonk creation readiness and keeps Pump independent", async () => {
  mocks.health.mockResolvedValue(Response.json({ missing: [], checks: { databaseReachable: true, workerFresh: true, treasuryRpcReachable: true,
    pumpSchemaReady: true, pumpPairReady: true, stonkPairReady: true, stonkCreationReady: false, stonkCreationError: "Venue configuration unavailable" } }));
  const result = await GET(new Request("https://example.test", { headers: { Authorization: "Bearer fixture-token" } }));
  expect(await result.json()).toMatchObject({ ready: false, pumpReady: true, stonkBlockers: ["Venue configuration unavailable"] });
});
it("requires operator authorization without contacting either venue", async () => {
  mocks.health.mockClear();
  expect((await GET(new Request("https://example.test"))).status).toBe(401);
  expect(mocks.health).not.toHaveBeenCalled();
});
