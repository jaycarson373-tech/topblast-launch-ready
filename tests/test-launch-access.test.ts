import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn(), pair: vi.fn(), readiness: vi.fn(), balance: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/db/launch-repository", () => ({ createLaunchDraft: mocks.save }));
vi.mock("@/lib/test-launch-readiness", () => ({ assertTestLaunchReady: mocks.readiness }));
vi.mock("@/lib/prepare-budget", () => ({ checkPrepareBudget: async () => null }));
vi.mock("@/lib/venue/registry", () => ({ launchVenue: () => ({ createLaunch: mocks.create, getPair: mocks.pair }) }));
vi.mock("@/lib/solana/pumpfun", () => ({ PUMP_SOL_MINT: "So11111111111111111111111111111111111111112" }));
vi.mock("@/lib/solana/rpc", () => ({ getTreasuryBalance: mocks.balance, solanaRpc: mocks.rpc }));
import { POST } from "@/app/api/launch/prepare/route";

const treasury = "884g5ENyiDoFfqDE8ibDbs88yG3HMpBAg7jsu9nRqMHM";
const stonk = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
function request(isTest: boolean, token?: string, venue = "stonkfun", creatorWallet = stonk) {
  return new Request("https://example.test/api/launch/prepare", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({
    isTest, venue, creatorWallet, name: "Acceptance test", symbol: "TST", description: "Test only", logo: "data:image/png;base64,AA==",
    quoteMint: venue === "pumpfun" ? "So11111111111111111111111111111111111111112" : stonk,
    quoteSymbol: venue === "pumpfun" ? "SOL" : "STONK", allocation: { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 },
  }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ADMIN_API_TOKEN", "fixture-operator-token");
  vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "false");
  vi.stubEnv("LAUNCHES_ENABLED", "false"); vi.stubEnv("PUMPFUN_ENABLED", "false");
  vi.stubEnv("TOPBLAST_TREASURY_ADDRESS", treasury);
  mocks.readiness.mockResolvedValue(undefined);
  mocks.rpc.mockImplementation(async (method) => method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : { value: { err: null } });
  mocks.pair.mockResolvedValue({ launchable: true });
  mocks.create.mockResolvedValue({ signedQuote: "quote", paymentTransaction: "unsigned", payment: { lamports: "1000" }, raw: {} });
  mocks.save.mockResolvedValue("test-id");
});
afterEach(() => vi.unstubAllEnvs());

describe("controlled test launch boundary, no real transactions", () => {
  it.each(["stonkfun", "pumpfun"])("rejects new %s test launches after public release, even for the operator", async (venue) => {
    vi.stubEnv("LAUNCHES_ENABLED", "true");
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    vi.stubEnv("CONTROLLED_LAUNCH_WALLETS", stonk);
    expect((await POST(request(true, "fixture-operator-token", venue))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["stonkfun", "pumpfun"])("opens token-free hidden %s tests only when explicitly enabled", async (venue) => {
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    expect((await POST(request(true, undefined, venue))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ isTest: true, venue }), "quote", "unsigned", undefined);
    expect((await POST(request(false, undefined, venue))).status).toBe(400);
  });
  it("public test access still requires worker health and a successful simulation", async () => {
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    mocks.readiness.mockRejectedValueOnce(new Error("Worker is stale"));
    expect((await POST(request(true))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.rpc.mockImplementation(async (method) => method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : { value: { err: "InsufficientFunds" } });
    expect((await POST(request(true))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([undefined, "wrong-token"])("rejects unauthenticated test creation (%s)", async (token) => {
    expect((await POST(request(true, token))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("cannot use admin access to open ordinary public creation", async () => {
    expect((await POST(request(false, "fixture-operator-token"))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["stonkfun", "pumpfun"])("allows only an authenticated hidden %s test while public launches stay closed", async (venue) => {
    expect((await POST(request(true, "fixture-operator-token", venue))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ isTest: true, venue }), "quote", "unsigned", undefined);
    expect(process.env.LAUNCHES_ENABLED).toBe("false");
    expect(process.env.PUMPFUN_ENABLED).toBe("false");
    if (venue === "stonkfun") expect(mocks.rpc).toHaveBeenCalledWith("simulateTransaction", expect.any(Array));
  });
  it("fails closed before contacting a venue when the migration/worker is unavailable", async () => {
    mocks.readiness.mockRejectedValue(new Error("Migration required"));
    expect((await POST(request(true, "fixture-operator-token"))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects using the reward treasury as the creator", async () => {
    expect((await POST(request(true, "fixture-operator-token", "stonkfun", treasury))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not save a payable quote when Stonk payment simulation fails", async () => {
    mocks.rpc.mockImplementation(async (method) => method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : { value: { err: "InsufficientFunds" } });
    expect((await POST(request(true, "fixture-operator-token"))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rechecks a fresh Stonk blockhash at confirmed commitment", async () => {
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    mocks.create.mockResolvedValue({ signedQuote: "quote", paymentTransaction: "unsigned", payment: { lamports: "1000" }, raw: { simulationSlot: 4321 } });
    expect((await POST(request(true))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("simulateTransaction", ["unsigned", expect.objectContaining({
      commitment: "confirmed",
      minContextSlot: 4321,
      replaceRecentBlockhash: false,
    })]);
  });
  it("rejects a different cluster", async () => {
    mocks.rpc.mockResolvedValue("devnet");
    expect((await POST(request(true, "fixture-operator-token"))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires an explicit successful simulation result", async () => {
    mocks.rpc.mockImplementation(async (method) => method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : { value: {} });
    expect((await POST(request(true, "fixture-operator-token"))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
