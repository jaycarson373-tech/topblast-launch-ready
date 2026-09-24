import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertStonkOperationTransaction, processStonkReceiver, reconcileStonkReceiverOperation } from "@/lib/funding/stonk-isolated";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), broadcast: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/solana/checked-transfers", () => ({ verifyFinalizedSignedTransaction: mocks.verify, broadcastSignedCheckedTransfer: mocks.broadcast, prepareCheckedTransfer: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: vi.fn() }));

function fixture() {
  const main = Keypair.generate(), child = Keypair.generate();
  const receiver = { id: "00000000-0000-4000-8000-000000000001", address: child.publicKey.toBase58(), treasury_address: main.publicKey.toBase58(), mint: Keypair.generate().publicKey.toBase58() };
  const tx = new Transaction({ feePayer: main.publicKey, recentBlockhash: SystemProgram.programId.toBase58() }).add(SystemProgram.transfer({ fromPubkey: main.publicKey, toPubkey: child.publicKey, lamports: 10000000 }));
  tx.sign(main);
  const signed = tx.serialize().toString("base64");
  const op = { id: "operation-a", receiver_id: receiver.id, launch_id: "launch-a", kind: "gas" as const, status: "submitted", asset_mint: NATIVE_MINT.toBase58(), amount_atoms: "10000000", signed_transaction: signed, signature: paymentSignatureFromTransaction(Buffer.from(signed, "base64")), last_valid_block_height: 200 };
  const writes: Record<string, unknown>[] = [];
  const chain = { eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { ...op, ...writes.at(-1) }, error: null })) };
  const from = vi.fn(() => ({ update: (value: Record<string, unknown>) => { writes.push(value); return chain; } }));
  return { receiver, op, writes, from, db: { from } as unknown as SupabaseClient };
}

describe("Stonk receiver durable restart recovery (simulated RPC)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
  it("rebroadcasts only the same signed receipt while it remains valid", async () => {
    const f = fixture(); mocks.verify.mockResolvedValue(null); mocks.rpc.mockResolvedValue(199); mocks.broadcast.mockResolvedValue(f.op.signature);
    await reconcileStonkReceiverOperation(f.db, f.op, f.receiver);
    await reconcileStonkReceiverOperation(f.db, f.op, f.receiver);
    expect(mocks.broadcast.mock.calls).toEqual([[f.op.signed_transaction], [f.op.signed_transaction]]);
    expect(f.writes).toEqual([]);
  });
  it("locks expired unobserved receipts without signing a replacement", async () => {
    const f = fixture(); mocks.verify.mockResolvedValue(null); mocks.rpc.mockResolvedValue(201);
    const result = await reconcileStonkReceiverOperation(f.db, f.op, f.receiver);
    expect(result.status).toBe("uncertain"); expect(f.writes[0].status).toBe("uncertain"); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("records finality and never repeats a confirmed top-up after restart", async () => {
    const f = fixture(); mocks.verify.mockResolvedValue({ slot: 123, blockTime: 1800000000, signature: f.op.signature });
    const confirmed = await reconcileStonkReceiverOperation(f.db, f.op, f.receiver);
    expect(confirmed.status).toBe("confirmed"); expect(f.writes).toHaveLength(1);
    expect(await reconcileStonkReceiverOperation(f.db, confirmed, f.receiver)).toEqual(confirmed);
    expect(f.writes).toHaveLength(1); expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("does not credit failed or unavailable RPC evidence", async () => {
    const f = fixture(); mocks.verify.mockRejectedValue(new Error("Finalized transaction failed"));
    await expect(reconcileStonkReceiverOperation(f.db, f.op, f.receiver)).rejects.toThrow("failed");
    expect(f.writes).toEqual([]); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("rejects substituted recipients, amounts and signatures before RPC or signing", async () => {
    const f = fixture();
    expect(() => assertStonkOperationTransaction(f.op, f.receiver, f.op.signed_transaction)).not.toThrow();
    expect(() => assertStonkOperationTransaction({ ...f.op, amount_atoms: "20000000" }, f.receiver, f.op.signed_transaction)).toThrow("intent");
    expect(() => assertStonkOperationTransaction(f.op, { ...f.receiver, address: Keypair.generate().publicKey.toBase58() }, f.op.signed_transaction)).toThrow("intent");
    await expect(reconcileStonkReceiverOperation(f.db, { ...f.op, signature: "wrong" }, f.receiver)).rejects.toThrow("signature");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("does not touch wallets or RPC in dry run", async () => {
    vi.stubEnv("DRY_RUN", "true"); vi.stubEnv("PAYOUT_MODE", "server_signer");
    const f = fixture();
    expect(await processStonkReceiver(f.db, {} as Parameters<typeof processStonkReceiver>[1], "worker")).toEqual({ status: "disabled" });
    expect(f.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
