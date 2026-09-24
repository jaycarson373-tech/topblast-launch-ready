import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), proof: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: mocks.db }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
vi.mock("@/lib/solana/checked-transfers", () => ({ verifyFinalizedSignedTransaction: mocks.proof, broadcastSignedCheckedTransfer: mocks.broadcast }));
import { reconcilePayoutBatch } from "@/lib/payout/service";

function fixture(status = "submitted", lastValidBlockHeight: unknown = 200) {
  const row = { id: "batch-a", launch_id: "launch-a", status, signature: "original-signature", signed_transaction: "original-signed-bytes", last_valid_block_height: lastValidBlockHeight, manifest_hash: "immutable-manifest" };
  const updates: Record<string, unknown>[] = [];
  const dbRpc = vi.fn(async () => ({ error: null }));
  const chain = { select: () => chain, eq: () => chain, neq: () => chain, single: async () => ({ data: row, error: null }), update: (values: Record<string, unknown>) => { updates.push(values); return chain; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  mocks.db.mockReturnValue({ from: () => chain, rpc: dbRpc });
  return { updates, dbRpc };
}
beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockResolvedValue(100); mocks.proof.mockResolvedValue(null); mocks.broadcast.mockResolvedValue("original-signature"); });

describe("durable payout restart recovery", () => {
  it("rebroadcasts saved bytes after a crash between persistence and submission", async () => {
    const { dbRpc } = fixture();
    expect(await reconcilePayoutBatch("batch-a")).toMatchObject({ status: "submitted", signature: "original-signature" });
    await reconcilePayoutBatch("batch-a");
    expect(mocks.broadcast.mock.calls).toEqual([["original-signed-bytes"], ["original-signed-bytes"]]);
    expect(dbRpc).not.toHaveBeenCalled();
  });
  it("keeps uncertain broadcast results bound to the original signature", async () => {
    fixture("uncertain"); mocks.broadcast.mockRejectedValue(new Error("timeout"));
    expect(await reconcilePayoutBatch("batch-a")).toMatchObject({ status: "submitted", signature: "original-signature" });
  });
  it("never replaces or broadcasts an expired signed transaction", async () => {
    const { updates, dbRpc } = fixture(); mocks.rpc.mockResolvedValue(201);
    expect(await reconcilePayoutBatch("batch-a")).toMatchObject({ status: "uncertain_expired" });
    expect(updates[0]).toMatchObject({ status: "uncertain" });
    expect(mocks.broadcast).not.toHaveBeenCalled(); expect(dbRpc).not.toHaveBeenCalled();
  });
  it.each([null, "bad", 0])("does not rebroadcast with invalid validity metadata: %j", async (height) => {
    fixture("submitted", height);
    await expect(reconcilePayoutBatch("batch-a")).rejects.toThrow("validity is unavailable");
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("records finalized proof without broadcasting", async () => {
    const { dbRpc } = fixture(); mocks.proof.mockResolvedValue({ slot: 123 });
    expect(await reconcilePayoutBatch("batch-a")).toMatchObject({ status: "confirmed" });
    expect(dbRpc).toHaveBeenCalledWith("confirm_payout_batch", { p_batch_id: "batch-a", p_slot: 123, p_proof: { version: 1, slot: 123, manifestHash: "immutable-manifest" } });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("never resends a confirmed payout on restart", async () => {
    fixture("confirmed");
    expect(await reconcilePayoutBatch("batch-a")).toMatchObject({ status: "confirmed" });
    expect(mocks.proof).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
