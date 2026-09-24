import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), sign: vi.fn(), broadcast: vi.fn(), signature: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc, solanaRpcUrl: () => "https://unused.invalid" }));
vi.mock("@/lib/solana/checked-transfers", () => ({ broadcastSignedCheckedTransfer: mocks.broadcast, verifyFinalizedSignedTransaction: vi.fn() }));
vi.mock("@/lib/payout/railway-signer", () => ({ createRailwaySigner: () => ({ signTransaction: mocks.sign }) }));
vi.mock("@/lib/solana/transaction-signature", () => ({ paymentSignatureFromTransaction: mocks.signature }));
import { advancePumpFeeOperation } from "@/lib/funding/pump-auto";

const treasury = new PublicKey("AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42");
const instructions = [SystemProgram.transfer({ fromPubkey: treasury, toPubkey: SystemProgram.programId, lamports: 1 })];
const operation = () => ({ id: "op-a", launch_id: "launch-a", kind: "setup" as const, status: "prepared", idempotency_key: "pump-setup:launch-a", unsigned_transaction: "old-unsigned", unsigned_message_hash: "old-hash", last_valid_block_height: 100, signature: null, signed_transaction: null });

function database(initial: Record<string, unknown>, lease = true, loseWrite = false) {
  const row = { ...initial }, writes: Record<string, unknown>[] = [];
  const rpc = vi.fn(async () => ({ data: lease, error: null }));
  const db = { rpc, from: () => ({ update(values: Record<string, unknown>) {
    const filters: Array<[string, unknown]> = [];
    const execute = async () => {
      if (loseWrite || !filters.every(([key, expected]) => row[key] === expected)) return { data: null, error: null };
      Object.assign(row, values); writes.push(values);
      return { data: { ...row }, error: null };
    };
    const chain = { eq(key: string, value: unknown) { filters.push([key, value]); return chain; }, is(key: string, value: unknown) { filters.push([key, value]); return chain; }, select() { return chain; }, maybeSingle: execute, then(resolve: (value: unknown) => unknown) { return execute().then(resolve); } };
    return chain;
  } }) };
  return { db: db as unknown as SupabaseClient, row, writes, rpc };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockImplementation(async (method: string) => {
    if (method === "getBlockHeight") return 150;
    if (method === "getLatestBlockhash") return { value: { blockhash: SystemProgram.programId.toBase58(), lastValidBlockHeight: 300 } };
    if (method === "simulateTransaction") return { value: { err: null } };
    throw Error(method);
  });
  mocks.sign.mockReturnValue(Buffer.from("signed-fixture").toString("base64"));
  mocks.signature.mockReturnValue("fixture-signature");
  mocks.broadcast.mockResolvedValue("fixture-signature");
});

describe("Pump fee operation restart and lease safety (simulation only)", () => {
  it("refreshes an expired UNSIGNED intent, persists the signature before broadcasting, and does not repeat it", async () => {
    const { db, row, writes } = database(operation());
    mocks.broadcast.mockImplementation(async () => { expect(row.status).toBe("signed"); expect(row.signature).toBe("fixture-signature"); });
    expect(await advancePumpFeeOperation(db, operation(), treasury, instructions, "worker")).toMatchObject({ status: "submitted", signature: "fixture-signature" });
    expect(mocks.sign.mock.calls[0][0].transactionBase64).not.toBe("old-unsigned");
    expect(writes[0]).toMatchObject({ last_valid_block_height: 300 });
    await advancePumpFeeOperation(db, { ...operation(), ...row }, treasury, instructions, "worker");
    expect(mocks.sign).toHaveBeenCalledOnce(); expect(mocks.broadcast).toHaveBeenCalledOnce();
  });
  it.each(["signed", "submitted", "uncertain", "confirmed"])("never rebuilds a %s receipt", async (status) => {
    const op = { ...operation(), status, signature: "original", signed_transaction: "original-bytes" };
    const { db } = database(op);
    expect(await advancePumpFeeOperation(db, op, treasury, instructions, "worker")).toMatchObject({ status, signature: "original" });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("does not sign after losing the treasury lease", async () => {
    const op = { ...operation(), last_valid_block_height: 300 };
    const { db } = database(op, false);
    expect(await advancePumpFeeOperation(db, op, treasury, instructions, "worker")).toEqual({ status: "lease_busy" });
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("does not sign an unsigned operation replaced by another worker", async () => {
    const { db } = database(operation(), true, true);
    expect(await advancePumpFeeOperation(db, operation(), treasury, instructions, "worker")).toEqual({ status: "lease_busy" });
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("does not broadcast when durable signature persistence loses its compare-and-set", async () => {
    const op = { ...operation(), last_valid_block_height: 300 };
    const { db } = database(op, true, true);
    expect(await advancePumpFeeOperation(db, op, treasury, instructions, "worker")).toEqual({ status: "lease_busy" });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it.each([{ value: {} }, {}, { value: { err: { InstructionError: [0, "failed"] } } }])("rejects failed or missing simulation proof: %j", async (simulation) => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "simulateTransaction" ? simulation : original(...args));
    const { db } = database(operation());
    await expect(advancePumpFeeOperation(db, operation(), treasury, instructions, "worker")).rejects.toThrow("simulation failed or was incomplete");
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("rejects corrupted prepared state containing signed bytes", async () => {
    const op = { ...operation(), signed_transaction: "existing-signed-receipt" };
    const { db } = database(op);
    await expect(advancePumpFeeOperation(db, op, treasury, instructions, "worker")).rejects.toThrow("already has a signed receipt");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
