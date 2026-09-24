import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createRailwaySigner } from "@/lib/payout/railway-signer";
import { assertStonkGasHeadroom, assertStonkReceiver, STONK_RECEIVER_GAS_LAMPORTS } from "@/lib/funding/stonk-isolated";

vi.mock("@/lib/db/server", () => ({ getAdminDb: vi.fn() }));
const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
describe("isolated Stonk receivers (synthetic signer fixtures)", () => {
  it("derives stable, distinct wallets across restarts without storing child secrets", () => {
    const master = Keypair.generate(), env = { TREASURY_PRIVATE_KEY: JSON.stringify([...master.secretKey]), TOPBLAST_TREASURY_ADDRESS: master.publicKey.toBase58() };
    const one = createRailwaySigner(env, a), restart = createRailwaySigner(env, a), two = createRailwaySigner(env, b);
    expect(one.publicKey()).toBe(restart.publicKey()); expect(one.publicKey()).not.toBe(two.publicKey()); expect(one.publicKey()).not.toBe(env.TOPBLAST_TREASURY_ADDRESS);
    expect(Object.keys(one).sort()).toEqual(["publicKey", "signTransaction"]);
    const tx = new Transaction({ feePayer: new PublicKey(one.publicKey()), recentBlockhash: SystemProgram.programId.toBase58() });
    tx.add(SystemProgram.transfer({ fromPubkey: tx.feePayer!, toPubkey: master.publicKey, lamports: 1 }));
    const request = { transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), expectedMessageHash: createHash("sha256").update(tx.serializeMessage()).digest("hex"), expectedPayer: one.publicKey() };
    expect(Transaction.from(Buffer.from(restart.signTransaction(request), "base64")).verifySignatures()).toBe(true);
    expect(() => two.signTransaction(request)).toThrow("fee payer");
    expect(() => createRailwaySigner({ ...env, TOPBLAST_TREASURY_ADDRESS: two.publicKey() }, a).publicKey()).toThrow("treasury");
    expect(() => createRailwaySigner(env, "../arbitrary")).toThrow("derivation");
  });
  it("rejects cross-token, substituted wallet and parent-treasury bindings", () => {
    const r = { id: a, address: "receiver-a", mint: "mint-a", treasury_address: "treasury" };
    const m = { launch_id: "launch-a", base_mint: "mint-a", quote_mint: "quote", market_address: "market-a", creator_address: "receiver-a", launch_slot: 1, last_indexed_slot: 2 };
    expect(() => assertStonkReceiver(r, m, "treasury", "receiver-a")).not.toThrow();
    expect(() => assertStonkReceiver(r, { ...m, base_mint: "mint-b" }, "treasury", "receiver-a")).toThrow("does not belong");
    expect(() => assertStonkReceiver(r, m, "treasury", "receiver-b")).toThrow("does not belong");
    expect(() => assertStonkReceiver(r, m, "different-treasury", "receiver-a")).toThrow("does not belong");
  });
  it("never funds 0.01 SOL gas from reward liabilities", () => {
    expect(STONK_RECEIVER_GAS_LAMPORTS).toBe(10000000n);
    expect(() => assertStonkGasHeadroom(50000000n, 40000000n)).toThrow("protected");
    expect(() => assertStonkGasHeadroom(55000000n, 40000000n)).not.toThrow();
    expect(() => assertStonkGasHeadroom(100000000n, -1n)).toThrow("protected");
  });
});
