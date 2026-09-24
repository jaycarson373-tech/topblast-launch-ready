import { createHash, createPublicKey, verify } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";

export function inspectSignedMessage(input: { signedTransaction: string; expectedMessageHash: string; expectedPayer: string }) {
  const bytes = Buffer.from(input.signedTransaction, "base64");
  if (bytes.length > 1232) throw new Error("Transaction exceeds Solana packet size");
  const transaction = VersionedTransaction.deserialize(bytes);
  const message = transaction.message.serialize();
  const hash = createHash("sha256").update(message).digest("hex");
  if (hash !== input.expectedMessageHash) throw new Error("Signed transaction instructions do not match the prepared transaction");
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== input.expectedPayer) throw new Error("Signed transaction fee payer changed");
  if (transaction.signatures.length !== transaction.message.header.numRequiredSignatures || transaction.signatures.some((signature, i) => !verify(null, message, createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), transaction.message.staticAccountKeys[i].toBuffer()]), format: "der", type: "spki" }), signature))) throw new Error("Transaction signature is missing or invalid");
  return { signature: paymentSignatureFromTransaction(bytes), bytes, transaction };
}
