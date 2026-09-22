import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), single: vi.fn(), venue: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }) }) }));
vi.mock("@/lib/db/launch-repository", () => ({ verifyLaunchPayment: mocks.verify, applyVenueLaunch: vi.fn() }));
vi.mock("@/lib/venue/registry", () => ({ launchVenue: mocks.venue }));
vi.mock("@/lib/venue/launch-submission-service", () => ({ submitBoundLaunch: vi.fn() }));
import { failedLaunchStatus } from "@/lib/venue/failed-launch-status";
import { GET } from "@/app/api/launch/status/[signature]/route";

const reason = "Expired without landing; no new transaction was submitted";
const mint = "Ht8X6b4QHXhVDGq5qhamTNXr5Qubr631EGBQqr5wK3Wd";
const receipt = { signed_quote: JSON.stringify({ venue: "stonkfun", method: "launchlab", mint, lastValidBlockHeight: 200 }), payment_signature: "sig" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.single.mockResolvedValue({ data: receipt, error: null });
  mocks.rpc.mockImplementation(async (method: string) => {
    if (method === "getGenesisHash") return "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    if (method === "getEpochInfo") return { blockHeight: 201, absoluteSlot: 250 };
    if (method === "getSignatureStatuses") return { context: { slot: 251 }, value: [null] };
    if (method === "getAccountInfo") return { context: { slot: 251 }, value: null };
    throw new Error(`Unexpected RPC: ${method}`);
  });
});

describe("expired launch recovery without another payment", () => {
  it("unlocks an explicit fresh review only after finalized expiry, absent signature and absent mint", async () => {
    expect(await failedLaunchStatus("launch-a", "sig", reason)).toMatchObject({ status: "failed", retrySafe: true });
    expect(mocks.rpc).toHaveBeenCalledWith("getAccountInfo", [mint, { commitment: "finalized", minContextSlot: 250, encoding: "base64" }]);
    expect(mocks.rpc.mock.calls.every(([method]) => method.startsWith("get"))).toBe(true);
  });
  it.each([
    ["getEpochInfo", { blockHeight: 200, absoluteSlot: 250 }],
    ["getSignatureStatuses", { context: { slot: 249 }, value: [null] }],
    ["getSignatureStatuses", { context: { slot: 251 }, value: [{ err: null, confirmationStatus: "confirmed" }] }],
    ["getSignatureStatuses", { context: { slot: 251 }, value: [] }],
    ["getAccountInfo", { context: { slot: 251 }, value: { owner: "program" } }],
    ["getAccountInfo", { context: { slot: 249 }, value: null }],
    ["getGenesisHash", "devnet"],
  ])("keeps retry locked for uncertain history: %s %j", async (method, value) => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === method ? value : original(...args));
    expect((await failedLaunchStatus("launch-a", "sig", reason)).retrySafe).toBe(false);
  });
  it("keeps the failed receipt readable when RPC is unavailable", async () => {
    mocks.rpc.mockRejectedValue(new Error("timeout"));
    expect(await failedLaunchStatus("launch-a", "sig", reason)).toMatchObject({ status: "failed", retrySafe: false, failureMessage: expect.stringContaining("unavailable") });
  });
  it("never uses another launch's receipt", async () => {
    expect((await failedLaunchStatus("launch-a", "other-sig", reason)).retrySafe).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not infer expiry from an arbitrary onchain failure", async () => {
    expect((await failedLaunchStatus("launch-a", "sig", "Program failed")).retrySafe).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("status endpoint returns saved terminal failure without calling a broadcasting adapter", async () => {
    mocks.single.mockResolvedValueOnce({ data: { venue: "stonkfun", status: "failed", payment_signature: "sig", venue_payload: { reason } }, error: null });
    const response = await GET(new Request("http://localhost/api/launch/status/sig?launchId=launch-a"), { params: Promise.resolve({ signature: "sig" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "failed", retrySafe: true });
    expect(mocks.venue).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("status endpoint rejects a mismatched signature before any RPC or recovery", async () => {
    mocks.single.mockResolvedValueOnce({ data: { status: "failed", payment_signature: "other" }, error: null });
    expect((await GET(new Request("http://localhost/api/launch/status/sig?launchId=launch-a"), { params: Promise.resolve({ signature: "sig" }) })).status).toBe(400);
    expect(mocks.venue).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
