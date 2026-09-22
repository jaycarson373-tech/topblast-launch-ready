import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(() => ({ paymentMessageHash: "hash", creatorWallet: "wallet", isTest: false })), inspect: vi.fn(), bind: vi.fn(), submit: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/db/launch-repository", () => ({ verifyLaunchQuote: mocks.verify, bindLaunchPayment: mocks.bind, applyVenueLaunch: mocks.apply }));
vi.mock("@/lib/venue/stonkfun-adapter", () => ({ StonkFunApiError: class extends Error {} }));
vi.mock("@/lib/venue/launch-submission-service", () => ({ submitBoundLaunch: mocks.submit }));
vi.mock("@/lib/solana/signed-message", () => ({ inspectSignedMessage: mocks.inspect }));
import { POST } from "@/app/api/launch/submit/route";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
beforeEach(() => vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "false"));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const bytes = new Uint8Array(66); bytes[0] = 1; bytes[64] = 1;
const input = { launchId: "00000000-0000-4000-8000-000000000001", signedQuote: "a".repeat(32), signedTransaction: Buffer.from(bytes).toString("base64"), logo: "data:image/png;base64,AA==" };
const request = () => new Request("http://localhost/api/launch/submit", { method: "POST", body: JSON.stringify(input) });
describe("launch payment recovery", () => {
  it("rejects submission of a pre-release test quote after public launch is enabled", async () => {
    vi.stubEnv("LAUNCHES_ENABLED", "true");
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    vi.stubEnv("CONTROLLED_LAUNCH_WALLETS", "wallet");
    mocks.verify.mockReturnValue({ paymentMessageHash: "hash", creatorWallet: "wallet", isTest: true });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("public test submission still validates the exact signed payment before durable binding", async () => {
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    mocks.verify.mockReturnValue({ paymentMessageHash: "hash", creatorWallet: "wallet", isTest: true });
    mocks.submit.mockResolvedValue({ status: "processing" });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.inspect).toHaveBeenCalledWith({ signedTransaction: input.signedTransaction, expectedMessageHash: "hash", expectedPayer: "wallet" });
    expect(mocks.inspect.mock.invocationCallOrder[0]).toBeLessThan(mocks.bind.mock.invocationCallOrder[0]);
    expect(mocks.bind.mock.invocationCallOrder[0]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
  });
  it("public access never permits an invalid signature to bind or submit", async () => {
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    mocks.verify.mockReturnValue({ paymentMessageHash: "hash", creatorWallet: "wallet", isTest: true });
    mocks.inspect.mockImplementation(() => { throw new Error("Transaction signature is missing or invalid"); });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("requires operator authorization for a saved hidden test before binding or submitting", async () => {
    mocks.verify.mockReturnValue({ paymentMessageHash: "hash", creatorWallet: "wallet", isTest: true });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("persists the exact payment ID before contacting the venue", async () => {
    mocks.submit.mockRejectedValue(new Error("connection lost"));
    await POST(request());
    expect(mocks.bind).toHaveBeenCalledWith(input.launchId, paymentSignatureFromTransaction(bytes), input.signedTransaction);
    expect(mocks.bind.mock.invocationCallOrder[0]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("never submits when durable payment binding fails", async () => {
    mocks.bind.mockRejectedValue(new Error("payment mismatch"));
    expect((await POST(request())).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("returns a safe error when the bound venue submission rejects the payment", async () => {
    mocks.submit.mockRejectedValue(new Error("Venue payment signature mismatch"));
    expect((await POST(request())).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
