import { createHash } from "node:crypto";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { solanaRpc } from "@/lib/solana/rpc";
import { inspectSignedMessage } from "@/lib/solana/signed-message";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

type ParsedMint = { value: { data?: { parsed?: { info?: { decimals?: number } } }; owner?: string } | null };
type LatestBlockhash = { value: { blockhash: string; lastValidBlockHeight: number } };
type Simulation = { value: { err: unknown; logs?: string[] } };

export interface CheckedTransfer {
  recipient: string;
  amountAtoms: bigint;
}

export interface PreparedCheckedTransfer {
  unsignedTransaction: string;
  messageHash: string;
  lastValidBlockHeight: number;
  decimals: number;
  sourceTokenAccount: string;
  destinationTokenAccounts: Array<{ recipient: string; tokenAccount: string; amountAtoms: string }>;
}

function messageHash(transaction: Transaction) {
  return createHash("sha256").update(transaction.serializeMessage()).digest("hex");
}

export async function prepareCheckedTransfer(input: {
  payer: string;
  mint: string;
  transfers: CheckedTransfer[];
  memo: string;
  wrapNative?: boolean;
}): Promise<PreparedCheckedTransfer> {
  if (!input.transfers.length) throw new Error("At least one transfer is required");
  if (input.transfers.some((item) => item.amountAtoms <= 0n)) throw new Error("Transfer amounts must be positive");
  const payer = new PublicKey(input.payer);
  const mint = new PublicKey(input.mint);
  const mintInfo = await solanaRpc<ParsedMint>("getAccountInfo", [mint.toBase58(), { encoding: "jsonParsed", commitment: "finalized" }]);
  if (!mintInfo.value) throw new Error("Reward mint account does not exist");
  if (mintInfo.value.owner !== TOKEN_PROGRAM_ID.toBase58()) throw new Error("Only the SPL Token program is supported for reward funding");
  const decimals = mintInfo.value.data?.parsed?.info?.decimals;
  if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 18) throw new Error("Reward mint decimals could not be verified");

  const source = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID);
  const destinations = input.transfers.map((item) => ({
    ...item,
    owner: new PublicKey(item.recipient),
    tokenAccount: getAssociatedTokenAddressSync(mint, new PublicKey(item.recipient), false, TOKEN_PROGRAM_ID),
  }));
  const latest = await solanaRpc<LatestBlockhash>("getLatestBlockhash", [{ commitment: "finalized" }]);
  const transaction = new Transaction({ feePayer: payer, recentBlockhash: latest.value.blockhash });
  if (input.wrapNative) {
    if (!mint.equals(NATIVE_MINT)) throw new Error("Only native SOL can be wrapped into WSOL");
    const required = input.transfers.reduce((sum, item) => sum + item.amountAtoms, 0n);
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(payer, source, payer, mint));
    transaction.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: source, lamports: required }));
    transaction.add(createSyncNativeInstruction(source));
  }
  for (const item of destinations) {
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(payer, item.tokenAccount, item.owner, mint, TOKEN_PROGRAM_ID));
    transaction.add(createTransferCheckedInstruction(source, mint, item.tokenAccount, payer, item.amountAtoms, decimals!, [], TOKEN_PROGRAM_ID));
  }
  transaction.add(new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(input.memo, "utf8"),
  }));
  const unsignedBytes = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  const simulation = await solanaRpc<Simulation>("simulateTransaction", [unsignedBytes.toString("base64"), {
    encoding: "base64", commitment: "finalized", sigVerify: false, replaceRecentBlockhash: false,
  }]);
  if (simulation.value?.err !== null) throw new Error(`Transaction simulation failed or incomplete: ${JSON.stringify(simulation.value?.err)} ${(simulation.value?.logs ?? []).slice(-2).join(" ")}`);
  return {
    unsignedTransaction: unsignedBytes.toString("base64"),
    messageHash: messageHash(transaction),
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    decimals: decimals!,
    sourceTokenAccount: source.toBase58(),
    destinationTokenAccounts: destinations.map((item) => ({ recipient: item.recipient, tokenAccount: item.tokenAccount.toBase58(), amountAtoms: item.amountAtoms.toString() })),
  };
}

export function inspectSignedCheckedTransfer(input: {
  signedTransaction: string;
  expectedMessageHash: string;
  expectedPayer: string;
}) {
  return inspectSignedMessage(input);
}

export async function broadcastSignedCheckedTransfer(signedTransaction: string) {
  const inspected = inspectSignedCheckedTransfer({
    signedTransaction,
    expectedMessageHash: messageHash(Transaction.from(Buffer.from(signedTransaction, "base64"))),
    expectedPayer: Transaction.from(Buffer.from(signedTransaction, "base64")).feePayer!.toBase58(),
  });
  const signature = await solanaRpc<string>("sendTransaction", [inspected.bytes.toString("base64"), {
    encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3,
  }]);
  if (signature !== inspected.signature) throw new Error("RPC returned an unexpected transaction signature");
  return signature;
}

type Base64Transaction = { slot: number; blockTime: number | null; meta: { err: unknown } | null; transaction: [string, string] } | null;

export async function verifyFinalizedSignedTransaction(signature: string, signedTransaction: string) {
  const result = await solanaRpc<Base64Transaction>("getTransaction", [signature, {
    commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0,
  }]);
  if (!result) return null;
  if (!result.meta || result.meta.err !== null) throw new Error("Finalized transaction failed or metadata incomplete");
  const expected = Buffer.from(signedTransaction, "base64");
  const actual = Buffer.from(result.transaction[0], "base64");
  if (!actual.equals(expected)) throw new Error("Finalized transaction bytes do not match the approved transaction");
  return { slot: result.slot, blockTime: result.blockTime, signature, transactionHash: createHash("sha256").update(actual).digest("hex") };
}
