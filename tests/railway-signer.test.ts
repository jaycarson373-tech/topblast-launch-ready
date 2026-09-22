import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createRailwaySigner, parseTreasurySecret } from "@/lib/payout/railway-signer";
import { inspectSignedMessage } from "@/lib/solana/signed-message";

function preparedTransaction(payer: Keypair) {
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: "11111111111111111111111111111111" });
  transaction.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const transactionBase64 = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const expectedMessageHash = createHash("sha256").update(transaction.serializeMessage()).digest("hex");
  return { transactionBase64, expectedMessageHash, expectedPayer: payer.publicKey.toBase58() };
}

describe("Railway treasury signer", () => {
  it("signs only the exact reviewed transaction for its configured treasury", () => {
    const payer = Keypair.generate();
    const signer = createRailwaySigner({ TREASURY_PRIVATE_KEY: JSON.stringify([...payer.secretKey]) });
    const prepared = preparedTransaction(payer);
    const signedTransaction = signer.signTransaction(prepared);
    expect(signer.publicKey()).toBe(prepared.expectedPayer);
    expect(inspectSignedMessage({ signedTransaction, ...prepared }).signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
  });

  it("rejects a changed message hash and a different fee payer", () => {
    const payer = Keypair.generate();
    const signer = createRailwaySigner({ TREASURY_PRIVATE_KEY: JSON.stringify([...payer.secretKey]) });
    const prepared = preparedTransaction(payer);
    expect(() => signer.signTransaction({ ...prepared, expectedMessageHash: "0".repeat(64) })).toThrow("message hash changed");
    expect(() => signer.signTransaction({ ...prepared, expectedPayer: Keypair.generate().publicKey.toBase58() })).toThrow("reviewed payout summary");
  });

  it("rejects malformed, short and multiline secrets", () => {
    expect(() => parseTreasurySecret("[1,2,3]")).toThrow("64 bytes");
    expect(() => parseTreasurySecret("not base58!")).toThrow("base58");
    expect(() => parseTreasurySecret(`${"1".repeat(32)}\n${"1".repeat(32)}`)).toThrow("invalid format");
  });
});
