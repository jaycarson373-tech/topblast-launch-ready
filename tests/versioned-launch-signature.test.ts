import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AddressLookupTableAccount, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { inspectSignedMessage } from "@/lib/solana/signed-message";

function fixture() {
  const payer = Keypair.generate(), mint = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: 18446744073709551615n, lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, addresses: [recipient] } });
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId }), SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 1 })] }).compileToV0Message([table]);
  const tx = new VersionedTransaction(message);
  const review = { expectedPayer: payer.publicKey.toBase58(), expectedMessageHash: createHash("sha256").update(message.serialize()).digest("hex") };
  return { tx, payer, mint, review };
}
describe("v0 launch signatures and immutable review binding", () => {
  it("accepts both valid signatures and preserves the exact signed wire", () => {
    const { tx, payer, mint, review } = fixture(); tx.sign([mint]); tx.sign([payer]);
    const wire = Buffer.from(tx.serialize()).toString("base64");
    expect(inspectSignedMessage({ ...review, signedTransaction: wire }).bytes.toString("base64")).toBe(wire);
  });
  it("rejects a missing mint signature or changed fee payer", () => {
    const { tx, payer, mint, review } = fixture(); tx.sign([payer]);
    expect(() => inspectSignedMessage({ ...review, signedTransaction: Buffer.from(tx.serialize()).toString("base64") })).toThrow("signature");
    tx.sign([mint]);
    expect(() => inspectSignedMessage({ ...review, expectedPayer: mint.publicKey.toBase58(), signedTransaction: Buffer.from(tx.serialize()).toString("base64") })).toThrow("fee payer");
  });
  it("rejects changed lookup indexes even when re-signed", () => {
    const { tx, payer, mint, review } = fixture();
    tx.message.addressTableLookups[0].writableIndexes[0] = 1;
    tx.sign([payer, mint]);
    expect(() => inspectSignedMessage({ ...review, signedTransaction: Buffer.from(tx.serialize()).toString("base64") })).toThrow("instructions");
  });
});
