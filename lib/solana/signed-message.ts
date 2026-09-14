import { createHash } from "node:crypto";
import { Transaction } from "@solana/web3.js";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";

export function inspectSignedMessage(input: { signedTransaction: string; expectedMessageHash: string; expectedPayer: string }) {
  const bytes = Buffer.from(input.signedTransaction, "base64");
  const transaction = Transaction.from(bytes);
  const hash = createHash("sha256").update(transaction.serializeMessage()).digest("hex");
  if (hash !== input.expectedMessageHash) throw new Error("Signed transaction instructions do not match the prepared transaction");
  if (transaction.feePayer?.toBase58() !== input.expectedPayer) throw new Error("Signed transaction fee payer changed");
  if (!transaction.verifySignatures()) throw new Error("Transaction signature is missing or invalid");
  return { signature: paymentSignatureFromTransaction(bytes), bytes, transaction };
}
