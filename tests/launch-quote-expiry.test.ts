import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }) }) }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
import { verifyLaunchQuote } from "@/lib/db/launch-repository";
import { launchReviewExpiry } from "@/lib/solana/launch-expiry";
const stored = (quote: string) => ({ data: { signed_quote_hash: createHash("sha256").update(quote).digest("hex"), status: "prepared", payment_message_hash: "exact-message-hash", creator_wallet: "creator", is_test: true, quote_expires_at: new Date(0).toISOString() }, error: null });
beforeEach(() => vi.resetAllMocks());
describe("quote expiry versus signed receipt recovery", () => {
  it.each([{ venue: "pumpfun" }, { venue: "stonkfun", method: "launchlab" }])("allows a late exact direct quote to proceed to signature validation and durable binding: %j", async (value) => {
    const quote = JSON.stringify(value); mocks.single.mockResolvedValue(stored(quote));
    expect(await verifyLaunchQuote("launch", quote)).toMatchObject({ paymentMessageHash: "exact-message-hash", creatorWallet: "creator" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not bypass expiry for an upstream fee quote", async () => {
    mocks.single.mockResolvedValue(stored("venue-signed-quote"));
    await expect(verifyLaunchQuote("launch", "venue-signed-quote")).rejects.toThrow("expired");
  });
  it("does not accept a substituted direct quote", async () => {
    mocks.single.mockResolvedValue(stored("original"));
    await expect(verifyLaunchQuote("launch", JSON.stringify({ venue: "pumpfun" }))).rejects.toThrow("does not match");
  });
  it("uses remaining block lifetime with a signing margin, not a fixed fresh timer", async () => {
    mocks.rpc.mockResolvedValue(100);
    const now = Date.now();
    expect(new Date(await launchReviewExpiry(200)).getTime() - now).toBeGreaterThanOrEqual(30_000);
    expect(new Date(await launchReviewExpiry(250)).getTime() - Date.now()).toBeLessThanOrEqual(50_000);
  });
  it.each([190, 201, NaN, undefined])("refuses stale or unverifiable quotes: %s", async (height) => {
    mocks.rpc.mockResolvedValue(height);
    await expect(launchReviewExpiry(200)).rejects.toThrow();
  });
});
