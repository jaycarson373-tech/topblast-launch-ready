import { createHash, randomUUID } from "node:crypto";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, decodeTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRailwaySigner } from "@/lib/payout/railway-signer";
import { prepareCheckedTransfer, broadcastSignedCheckedTransfer, verifyFinalizedSignedTransaction } from "@/lib/solana/checked-transfers";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import { solanaRpc } from "@/lib/solana/rpc";
import { inspectLaunchLabMarket } from "@/lib/solana/launchlab";

export const STONK_RECEIVER_GAS_LAMPORTS = 10_000_000n;
const OPERATING_RESERVE = 5_000_000n;
type Receiver = { id: string; address: string; mint: string | null; treasury_address: string };
type Market = { launch_id: string; base_mint: string; quote_mint: string; market_address: string; creator_address: string; launch_slot: string | number; last_indexed_slot: string | number };
type Operation = { id: string; launch_id: string; receiver_id: string; kind: "gas" | "sweep"; status: string; asset_mint: string; amount_atoms: string; unsigned_transaction?: string; unsigned_message_hash?: string; signed_transaction?: string; signature?: string; last_valid_block_height?: number; slot?: number };
const hash = (tx: Transaction) => createHash("sha256").update(tx.serializeMessage()).digest("hex");
const enabled = () => process.env.DRY_RUN === "false" && process.env.PAYOUT_MODE === "server_signer";

// Revalidate persisted instructions, not only their stored hash, before signing
// or crediting. A receipt must describe exactly this launch's gas or sweep.
export function assertStonkOperationTransaction(op: Operation, receiver: Receiver, wire: string) {
  const tx = Transaction.from(Buffer.from(wire, "base64"));
  const treasury = new PublicKey(receiver.treasury_address), address = new PublicKey(receiver.address);
  const payer = op.kind === "gas" ? treasury : address;
  if (op.receiver_id !== receiver.id || !tx.feePayer?.equals(payer)) throw new Error("Stonk operation payer or receiver mismatch");
  let expected: TransactionInstruction[];
  if (op.kind === "gas") {
    if (op.asset_mint !== NATIVE_MINT.toBase58() || BigInt(op.amount_atoms) !== STONK_RECEIVER_GAS_LAMPORTS) throw new Error("Stonk gas intent mismatch");
    expected = [SystemProgram.transfer({ fromPubkey: treasury, toPubkey: address, lamports: STONK_RECEIVER_GAS_LAMPORTS })];
  } else {
    if (BigInt(op.amount_atoms) <= 0n || tx.instructions.length !== 3) throw new Error("Stonk sweep intent mismatch");
    const mint = new PublicKey(op.asset_mint), source = getAssociatedTokenAddressSync(mint, address), destination = getAssociatedTokenAddressSync(mint, treasury);
    const decoded = decodeTransferCheckedInstruction(tx.instructions[1]);
    expected = [createAssociatedTokenAccountIdempotentInstruction(address, destination, treasury, mint),
      createTransferCheckedInstruction(source, mint, destination, address, BigInt(op.amount_atoms), decoded.data.decimals),
      new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [{ pubkey: address, isSigner: true, isWritable: false }], data: Buffer.from(`TOPBLAST:STONK:${op.launch_id}:${op.id}`) })];
  }
  // Compiling merges writable flags for repeated accounts (the fee payer is
  // writable globally), so compare normalized messages with the same blockhash.
  const canonical = new Transaction({ feePayer: payer, recentBlockhash: tx.recentBlockhash }).add(...expected);
  if (!canonical.serializeMessage().equals(tx.serializeMessage())) throw new Error("Stonk transaction differs from its immutable intent");
}
async function lease(db: SupabaseClient, type: string, id: string, owner: string) {
  const r = await db.rpc("claim_worker_lease", { p_resource_type: type, p_resource_id: id, p_owner_id: owner, p_seconds: 90 });
  if (r.error) throw r.error;
  return r.data === true;
}

export async function provisionStonkReceivers(db: SupabaseClient, owner: string) {
  if (!enabled()) return;
  const treasury = process.env.TOPBLAST_TREASURY_ADDRESS;
  if (!treasury || createRailwaySigner().publicKey() !== treasury) throw new Error("Stonk receiver treasury signer mismatch");
  if (!await lease(db, "stonk_receiver_pool", treasury, owner)) return;
  const available = await db.from("stonk_fee_receivers").select("id", { count: "exact", head: true }).is("mint", null).eq("treasury_address", treasury);
  if (available.error) throw available.error;
  const rows = Array.from({ length: Math.max(0, 8 - (available.count ?? 0)) }, () => {
    const id = randomUUID();
    return { id, address: createRailwaySigner(process.env, id).publicKey(), treasury_address: treasury };
  });
  if (rows.length) {
    const saved = await db.from("stonk_fee_receivers").insert(rows);
    if (saved.error) throw saved.error;
  }
}

export function assertStonkReceiver(receiver: Receiver, market: Market, treasury: string, derivedAddress: string) {
  if (receiver.treasury_address !== treasury || receiver.mint !== market.base_mint || receiver.address !== market.creator_address || receiver.address !== derivedAddress || receiver.address === treasury) throw new Error("Stonk receiver does not belong to this launch and treasury");
}

export function assertStonkGasHeadroom(balance: bigint, protectedAtoms: bigint) {
  if (protectedAtoms < 0n || balance < protectedAtoms + STONK_RECEIVER_GAS_LAMPORTS + OPERATING_RESERVE) throw new Error("Insufficient spare treasury SOL for the one-time 0.01 SOL receiver top-up; reward funds are protected");
}

async function gasHeadroom(db: SupabaseClient, treasury: string) {
  const protectedFunds = await db.rpc("stonk_gas_protected_sol");
  if (protectedFunds.error) throw protectedFunds.error;
  const balance = await solanaRpc<{ value: number }>("getBalance", [treasury, { commitment: "finalized" }]);
  if (!Number.isSafeInteger(balance.value)) throw new Error("Treasury SOL balance is not exact");
  assertStonkGasHeadroom(BigInt(balance.value), BigInt(protectedFunds.data));
}

async function prepareGas(db: SupabaseClient, receiver: Receiver) {
  await gasHeadroom(db, receiver.treasury_address);
  const latest = await solanaRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const transaction = new Transaction({ feePayer: new PublicKey(receiver.treasury_address), recentBlockhash: latest.value.blockhash })
    .add(SystemProgram.transfer({ fromPubkey: new PublicKey(receiver.treasury_address), toPubkey: new PublicKey(receiver.address), lamports: STONK_RECEIVER_GAS_LAMPORTS }));
  const unsignedTransaction = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const simulation = await solanaRpc<{ value: { err: unknown } }>("simulateTransaction", [unsignedTransaction, { encoding: "base64", commitment: "confirmed", sigVerify: false }]);
  if (simulation.value?.err !== null) throw new Error("Stonk receiver gas simulation failed or incomplete");
  return { unsignedTransaction, messageHash: hash(transaction), lastValidBlockHeight: latest.value.lastValidBlockHeight };
}

async function operationFor(db: SupabaseClient, input: { launch_id: string; receiver_id: string; kind: "gas" | "sweep"; asset_mint: string; amount_atoms: string; idempotency_key: string }) {
  const insert = await db.from("stonk_receiver_operations").upsert(input, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("*").maybeSingle();
  if (insert.error) throw insert.error;
  if (insert.data) return insert.data as Operation;
  const previous = await db.from("stonk_receiver_operations").select("*").eq("idempotency_key", input.idempotency_key).single();
  if (previous.error) throw previous.error;
  return previous.data as Operation;
}

export async function reconcileStonkReceiverOperation(db: SupabaseClient, op: Operation, receiver: Receiver) {
  if (!["signed", "submitted", "uncertain"].includes(op.status)) return op;
  if (!op.signature || !op.signed_transaction) throw new Error("Stonk receiver operation is missing its durable signed receipt");
  assertStonkOperationTransaction(op, receiver, op.signed_transaction);
  if (paymentSignatureFromTransaction(Buffer.from(op.signed_transaction, "base64")) !== op.signature) throw new Error("Stonk operation signature mismatch");
  const proof = await verifyFinalizedSignedTransaction(op.signature, op.signed_transaction);
  if (!proof) {
    const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
    if (!Number.isSafeInteger(height) || !Number.isSafeInteger(Number(op.last_valid_block_height))) throw new Error("Stonk receiver blockheight unavailable");
    if (height <= Number(op.last_valid_block_height)) await broadcastSignedCheckedTransfer(op.signed_transaction).catch(() => undefined);
    else {
      const updated = await db.from("stonk_receiver_operations").update({ status: "uncertain", error_message: "Original signed receipt needs archival reconciliation; no replacement or second gas top-up is allowed", updated_at: new Date().toISOString() }).eq("id", op.id).neq("status", "confirmed");
      if (updated.error) throw updated.error;
    }
    return { ...op, status: "uncertain" };
  }
  if (!Number.isSafeInteger(proof.slot) || !Number.isSafeInteger(proof.blockTime)) throw new Error("Finalized Stonk receiver proof is incomplete");
  const payload = { ...proof, type: op.kind === "gas" ? "stonk_receiver_gas" : "stonk_isolated_receiver_sweep", amountAtoms: String(op.amount_atoms), mint: op.asset_mint, receiver: receiver.address, treasury: receiver.treasury_address, launchId: op.launch_id,
    // A dedicated pool can also receive voluntary token deposits. A sweep is
    // proof of attributable funding, not proof that every atom was a venue fee.
    fundingSource: op.kind === "sweep" ? "isolated_receiver_balance" : "treasury_operating_sol" };
  const saved = await db.from("stonk_receiver_operations").update({ status: "confirmed", slot: proof.slot, proof: payload, error_message: null, updated_at: new Date().toISOString() }).eq("id", op.id).neq("status", "confirmed").select("*").maybeSingle();
  if (saved.error) throw saved.error;
  return (saved.data ?? { ...op, status: "confirmed", slot: proof.slot }) as Operation;
}

async function advanceOperation(db: SupabaseClient, initial: Operation, receiver: Receiver, owner: string) {
  let op = initial;
  if (!["planned", "prepared"].includes(op.status)) return reconcileStonkReceiverOperation(db, op, receiver);
  if (op.signature || op.signed_transaction) throw new Error("Unsigned Stonk operation contains a signed receipt");
  const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "confirmed" }]);
  if (!Number.isSafeInteger(height)) throw new Error("Stonk receiver blockheight unavailable");
  if (op.status === "planned" || !Number.isSafeInteger(Number(op.last_valid_block_height)) || Number(op.last_valid_block_height) - height < 20) {
    const prepared = op.kind === "gas" ? await prepareGas(db, receiver) : await prepareCheckedTransfer({ payer: receiver.address, mint: op.asset_mint, transfers: [{ recipient: receiver.treasury_address, amountAtoms: BigInt(op.amount_atoms) }], memo: `TOPBLAST:STONK:${op.launch_id}:${op.id}` });
    const saved = await db.from("stonk_receiver_operations").update({ status: "prepared", unsigned_transaction: prepared.unsignedTransaction, unsigned_message_hash: prepared.messageHash, last_valid_block_height: prepared.lastValidBlockHeight, updated_at: new Date().toISOString() })
      .eq("id", op.id).eq("status", op.status).is("signature", null).is("signed_transaction", null).select("*").maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) return { ...op, status: "lease_busy" };
    op = saved.data as Operation;
  }
  if (!await lease(db, "stonk_receiver", receiver.id, owner) || !await lease(db, "payout_treasury", receiver.treasury_address, owner)) return { ...op, status: "lease_busy" };
  if (op.kind === "gas") await gasHeadroom(db, receiver.treasury_address);
  const freshHeight = await solanaRpc<number>("getBlockHeight", [{ commitment: "confirmed" }]);
  if (!Number.isSafeInteger(freshHeight) || Number(op.last_valid_block_height) - freshHeight < 20) throw new Error("Stonk receiver preparation expired before signing; unsigned operation will be refreshed");
  const signer = createRailwaySigner(process.env, op.kind === "gas" ? undefined : receiver.id);
  const payer = op.kind === "gas" ? receiver.treasury_address : receiver.address;
  if (signer.publicKey() !== payer) throw new Error("Stonk receiver signer mismatch");
  assertStonkOperationTransaction(op, receiver, String(op.unsigned_transaction));
  const signed = signer.signTransaction({ transactionBase64: String(op.unsigned_transaction), expectedMessageHash: String(op.unsigned_message_hash), expectedPayer: payer });
  const signature = paymentSignatureFromTransaction(Buffer.from(signed, "base64"));
  const saved = await db.from("stonk_receiver_operations").update({ status: "signed", signed_transaction: signed, signature, updated_at: new Date().toISOString() })
    .eq("id", op.id).eq("status", "prepared").eq("unsigned_message_hash", op.unsigned_message_hash).is("signature", null).is("signed_transaction", null).select("*").maybeSingle();
  if (saved.error) throw saved.error;
  if (!saved.data) return { ...op, status: "lease_busy" };
  await broadcastSignedCheckedTransfer(signed).catch(() => undefined);
  const submitted = await db.from("stonk_receiver_operations").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("id", op.id).eq("status", "signed");
  if (submitted.error) throw submitted.error;
  return { ...saved.data, status: "submitted" } as Operation;
}

export async function processStonkReceiver(db: SupabaseClient, market: Market, owner: string) {
  if (!enabled()) return { status: "disabled" };
  const lookup = await db.from("stonk_fee_receivers").select("*").eq("mint", market.base_mint).maybeSingle();
  if (lookup.error) throw lookup.error;
  if (!lookup.data) return { status: "legacy_attribution_required" };
  const receiver = lookup.data as Receiver, treasury = process.env.TOPBLAST_TREASURY_ADDRESS!;
  assertStonkReceiver(receiver, market, treasury, createRailwaySigner(process.env, receiver.id).publicKey());
  const launch = await db.from("launches").select("status,venue,mint,quote_mint").eq("id", market.launch_id).single();
  if (launch.error) throw launch.error;
  if (launch.data.status !== "active") return { status: "paused" };
  if (launch.data.venue !== "stonkfun" || launch.data.mint !== market.base_mint || launch.data.quote_mint !== market.quote_mint) throw new Error("Stonk receiver launch mismatch");
  if (!await lease(db, "stonk_receiver", receiver.id, owner) || !await lease(db, "payout_treasury", treasury, owner)) return { status: "lease_busy" };
  await inspectLaunchLabMarket({ mint: market.base_mint, pool: market.market_address, quoteMint: market.quote_mint, creator: receiver.address, feeRecipient: receiver.address });
  // Credit only finalized transfers whose operation is bound to this mint.
  const confirmed = await db.from("stonk_receiver_operations").select("id,slot").eq("launch_id", market.launch_id).eq("kind", "sweep").eq("status", "confirmed");
  if (confirmed.error) throw confirmed.error;
  for (const op of confirmed.data ?? []) {
    if (Number(op.slot) > Number(market.last_indexed_slot)) return { status: "awaiting_index" };
    const credited = await db.rpc("credit_stonk_receiver_sweep", { p_operation_id: op.id });
    if (credited.error) throw credited.error;
  }
  const active = await db.from("stonk_receiver_operations").select("*").eq("receiver_id", receiver.id).in("status", ["planned", "prepared", "signed", "submitted", "uncertain"]).order("created_at").limit(1).maybeSingle();
  if (active.error) throw active.error;
  if (active.data) {
    if (active.data.launch_id !== market.launch_id || (active.data.kind === "gas" ? active.data.asset_mint !== NATIVE_MINT.toBase58() || BigInt(active.data.amount_atoms) !== STONK_RECEIVER_GAS_LAMPORTS : active.data.asset_mint !== market.quote_mint)) throw new Error("Stonk operation does not match this launch");
    return advanceOperation(db, active.data as Operation, receiver, owner);
  }
  const gas = await operationFor(db, { launch_id: market.launch_id, receiver_id: receiver.id, kind: "gas", asset_mint: NATIVE_MINT.toBase58(), amount_atoms: String(STONK_RECEIVER_GAS_LAMPORTS), idempotency_key: `stonk-gas:${receiver.id}` });
  if (gas.status !== "confirmed") return advanceOperation(db, gas, receiver, owner);
  const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(market.quote_mint), new PublicKey(receiver.address), false, TOKEN_PROGRAM_ID).toBase58();
  const minContextSlot = Math.max(Number(market.launch_slot), ...(confirmed.data ?? []).map(op => Number(op.slot)));
  const account = await solanaRpc<{ context: { slot: number }; value: { owner: string; data?: { parsed?: { info?: { owner: string; mint: string; tokenAmount: { amount: string } } } } } | null }>("getAccountInfo", [tokenAccount, { encoding: "jsonParsed", commitment: "finalized", minContextSlot }]);
  if (!Number.isSafeInteger(account.context?.slot)) throw new Error("Stonk receiver balance context unavailable");
  if (!account.value) return { status: "awaiting_venue_forward" };
  const info = account.value.data?.parsed?.info;
  if (account.value.owner !== TOKEN_PROGRAM_ID.toBase58() || info?.mint !== market.quote_mint || info.owner !== receiver.address || !/^\d+$/.test(info.tokenAmount.amount)) throw new Error("Stonk receiver token account identity mismatch");
  const balance = BigInt(info.tokenAmount.amount);
  if (!balance) return { status: "awaiting_venue_forward" };
  const cap = process.env.TOPBLAST_MAX_PAYOUT_ATOMS;
  if (!cap || !/^[1-9][0-9]*$/.test(cap)) throw new Error("TOPBLAST_MAX_PAYOUT_ATOMS is required for receiver sweeps");
  const amount = balance < BigInt(cap) ? balance : BigInt(cap);
  const sweep = await operationFor(db, { launch_id: market.launch_id, receiver_id: receiver.id, kind: "sweep", asset_mint: market.quote_mint, amount_atoms: amount.toString(), idempotency_key: `stonk-sweep:${receiver.id}:${account.context.slot}:${balance}` });
  return advanceOperation(db, sweep, receiver, owner);
}
