import { createHash, createHmac } from "node:crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { decode58 } from "@/lib/indexer/launchlab-decoder";
import { inspectSignedMessage } from "@/lib/solana/signed-message";

export function parseTreasurySecret(value: string | undefined) {
  if (typeof value !== "string" || !value.trim()) throw new Error("TREASURY_PRIVATE_KEY is missing");
  const input = value.trim();
  if (input.length > 1024 || /[\r\n]/.test(input)) throw new Error("TREASURY_PRIVATE_KEY has an invalid format");
  let bytes: Uint8Array;
  if (input.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(input); }
    catch { throw new Error("TREASURY_PRIVATE_KEY JSON is invalid"); }
    if (!Array.isArray(parsed) || !parsed.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new Error("TREASURY_PRIVATE_KEY must be a byte array");
    }
    bytes = Uint8Array.from(parsed);
  } else {
    try { bytes = Uint8Array.from(decode58(input)); }
    catch { throw new Error("TREASURY_PRIVATE_KEY must be base58 or a JSON byte array"); }
  }
  if (bytes.length !== 64) throw new Error("TREASURY_PRIVATE_KEY must decode to 64 bytes");
  return bytes;
}

export function createRailwaySigner(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>, receiverId?: string) {
  if (receiverId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receiverId)) throw new Error("Invalid Stonk receiver derivation ID");
  let signer: Keypair | null = null;
  function getSigner() {
    if (signer) return signer;
    const bytes = parseTreasurySecret(env.TREASURY_PRIVATE_KEY);
    try {
      const parent = Keypair.fromSecretKey(Uint8Array.from(bytes));
      if (receiverId === undefined) signer = parent;
      else {
        if (parent.publicKey.toBase58() !== env.TOPBLAST_TREASURY_ADDRESS) throw new Error("Receiver derivation treasury does not match configured signer");
        // Stable, domain-separated child keys live only inside the worker.
        // The database stores the UUID/public address, never the derived secret.
        const seed = createHmac("sha256", parent.secretKey.subarray(0, 32)).update(`topblast:stonk-fee-receiver:v1:${receiverId}`).digest();
        try { signer = Keypair.fromSeed(seed); } finally { seed.fill(0); parent.secretKey.fill(0); }
      }
    }
    finally { bytes.fill(0); }
    return signer;
  }
  return {
    publicKey() { return getSigner().publicKey.toBase58(); },
    signTransaction(input: { transactionBase64: string; expectedMessageHash: string; expectedPayer: string }) {
      if (!input.transactionBase64 || !input.expectedMessageHash || !input.expectedPayer) throw new Error("Invalid signing request");
      const keypair = getSigner();
      const transaction = Transaction.from(Buffer.from(input.transactionBase64, "base64"));
      if (!transaction.feePayer?.equals(keypair.publicKey)) throw new Error("Treasury key does not match transaction fee payer");
      if (!new PublicKey(input.expectedPayer).equals(keypair.publicKey)) throw new Error("Treasury key does not match reviewed payout summary");
      const actualHash = createHash("sha256").update(transaction.serializeMessage()).digest("hex");
      if (actualHash !== input.expectedMessageHash) throw new Error("Prepared payout message hash changed before signing");
      transaction.sign(keypair);
      const signedTransaction = transaction.serialize().toString("base64");
      inspectSignedMessage({ signedTransaction, expectedMessageHash: input.expectedMessageHash, expectedPayer: input.expectedPayer });
      return signedTransaction;
    },
  };
}
