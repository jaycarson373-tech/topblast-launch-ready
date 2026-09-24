import { createHash } from "node:crypto";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decode58 } from "@/lib/indexer/launchlab-decoder";
import { broadcastSignedCheckedTransfer, verifyFinalizedSignedTransaction } from "@/lib/solana/checked-transfers";
import { createRailwaySigner } from "@/lib/payout/railway-signer";
import { OnlinePumpSdk, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID, PUMP_SDK, creatorVaultPda, feeSharingConfigPda, pumpIdl, type SharingConfig } from "@/lib/solana/pump-sdk";
import { inspectPumpQuoteMint, normalizedPumpQuote, readPumpCurve } from "@/lib/solana/pumpfun";
import { solanaRpc, solanaRpcUrl } from "@/lib/solana/rpc";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";

interface PumpMarket {
  launch_id: string;
  launch_slot: string | number;
  last_indexed_slot: string | number;
  market_address: string;
  base_mint: string;
  quote_mint: string;
  quote_token_program: string;
  creator_address: string;
}

type Operation = Record<string, unknown> & { id: string; launch_id: string; kind: "setup" | "distribute"; status: string; idempotency_key: string };
type Result = { status: "disabled" | "lease_busy" | "idle" | "submitted" | "awaiting_finality" | "awaiting_index" | "confirmed" | "uncertain"; signature?: string | null; amountAtoms?: string };
const cpiTag = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);
const distributeTag = Buffer.from((pumpIdl.events as Array<{ name: string; discriminator: number[] }>).find((event) => event.name.toLowerCase() === "distributecreatorfeesevent")!.discriminator);

function messageHash(transaction: Transaction) {
  return createHash("sha256").update(transaction.serializeMessage()).digest("hex");
}

async function loadSharingConfig(mint: PublicKey): Promise<{ address: PublicKey; config: SharingConfig } | null> {
  const address = feeSharingConfigPda(mint);
  const response = await solanaRpc<{ value: { owner: string; lamports: number; data: [string, string]; executable: boolean } | null }>("getAccountInfo", [address.toBase58(), { encoding: "base64", commitment: "finalized" }]);
  if (!response.value) return null;
  if (response.value.owner !== PUMP_FEE_PROGRAM_ID.toBase58() || response.value.executable || response.value.data?.[1] !== "base64" || !Number.isSafeInteger(response.value.lamports)) throw new Error("Pump fee-sharing config account is invalid");
  return { address, config: PUMP_SDK.decodeSharingConfig({ ...response.value, owner: PUMP_FEE_PROGRAM_ID, data: Buffer.from(response.value.data[0], "base64") }) };
}

function assertTreasuryConfig(mint: PublicKey, treasury: PublicKey, loaded: { address: PublicKey; config: SharingConfig }) {
  const { config } = loaded;
  if (!config.mint.equals(mint) || !config.admin.equals(treasury) || !config.adminRevoked || config.shareholders.length !== 1 || !config.shareholders[0].address.equals(treasury) || config.shareholders[0].shareBps !== 10_000) {
    throw new Error("Pump fee-sharing config does not match the immutable TopBlast treasury route");
  }
}

async function prepareTransaction(treasury: PublicKey, instructions: TransactionInstruction[]) {
  const latest = await solanaRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
  const transaction = new Transaction({ feePayer: treasury, recentBlockhash: latest.value.blockhash })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...instructions);
  const unsigned = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const simulation = await solanaRpc<{ value: { err: unknown; logs?: string[] } }>("simulateTransaction", [unsigned, { encoding: "base64", commitment: "finalized", sigVerify: false, replaceRecentBlockhash: false }]);
  if (simulation.value.err) throw new Error(`Pump fee transaction simulation failed: ${JSON.stringify(simulation.value.err)} ${(simulation.value.logs ?? []).slice(-3).join(" ")}`);
  return { unsigned, hash: messageHash(transaction), lastValidBlockHeight: latest.value.lastValidBlockHeight };
}

async function operationFor(db: SupabaseClient, launchId: string, kind: Operation["kind"], idempotencyKey: string) {
  const inserted = await db.from("pump_fee_operations").upsert({ launch_id: launchId, kind, idempotency_key: idempotencyKey }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("*").maybeSingle();
  if (inserted.error) throw inserted.error;
  if (inserted.data) return inserted.data as Operation;
  const existing = await db.from("pump_fee_operations").select("*").eq("idempotency_key", idempotencyKey).single();
  if (existing.error) throw existing.error;
  return existing.data as Operation;
}

async function advanceOperation(db: SupabaseClient, operation: Operation, treasury: PublicKey, instructions: TransactionInstruction[]) {
  let row = operation;
  if (row.status === "planned") {
    const prepared = await prepareTransaction(treasury, instructions);
    const updated = await db.from("pump_fee_operations").update({ status: "prepared", unsigned_transaction: prepared.unsigned, unsigned_message_hash: prepared.hash, last_valid_block_height: prepared.lastValidBlockHeight, error_message: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "planned").select("*").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return { status: "lease_busy" as const };
    row = updated.data as Operation;
  }
  if (row.status === "prepared") {
    const signer = createRailwaySigner();
    const signed = signer.signTransaction({ transactionBase64: String(row.unsigned_transaction), expectedMessageHash: String(row.unsigned_message_hash), expectedPayer: treasury.toBase58() });
    const signature = paymentSignatureFromTransaction(Buffer.from(signed, "base64"));
    const persisted = await db.from("pump_fee_operations").update({ status: "signed", signed_transaction: signed, signature, updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "prepared").select("id").maybeSingle();
    if (persisted.error) throw persisted.error;
    if (!persisted.data) return { status: "lease_busy" as const };
    await broadcastSignedCheckedTransfer(signed).catch(() => undefined);
    const submitted = await db.from("pump_fee_operations").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "signed");
    if (submitted.error) throw submitted.error;
    return { status: "submitted" as const, signature };
  }
  return { status: row.status as "submitted" | "uncertain" | "confirmed", signature: row.signature ? String(row.signature) : null };
}

type ParsedTx = {
  slot: number; blockTime: number | null;
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[]; innerInstructions?: Array<{ instructions: Ix[] }> } | null;
  transaction: { signatures: string[]; message: { accountKeys: Array<string | { pubkey: string }>; instructions: Ix[] } };
};
type Ix = { programId?: string; data?: string };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } };

export function verifyPumpFeeDistribution(tx: ParsedTx, signature: string, market: PumpMarket, treasury: PublicKey, sharing: PublicKey) {
  if (!tx.meta || tx.meta.err || tx.transaction.signatures[0] !== signature || !Number.isSafeInteger(tx.slot) || !Number.isSafeInteger(tx.blockTime)) throw new Error("Pump fee distribution is not finalized proof");
  const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((item) => item.instructions)];
  const events = instructions.flatMap((instruction) => {
    if (instruction.programId !== PUMP_PROGRAM_ID.toBase58() || !instruction.data) return [];
    const bytes = decode58(instruction.data);
    if (!bytes.subarray(0, 8).equals(cpiTag) || !bytes.subarray(8, 16).equals(distributeTag)) return [];
    return [PUMP_SDK.decodeDistributeCreatorFeesEvent(bytes.subarray(16))];
  });
  if (events.length !== 1) throw new Error("Pump fee distribution event is missing or ambiguous");
  const event = events[0];
  const quoteMint = normalizedPumpQuote(event.quoteMint).toBase58();
  const amount = BigInt(event.distributed.toString());
  if (!event.mint.equals(new PublicKey(market.base_mint)) || !event.sharingConfig.equals(sharing) || !event.admin.equals(treasury) || quoteMint !== market.quote_mint || amount <= 0n || event.shareholders.length !== 1 || !event.shareholders[0].address.equals(treasury) || event.shareholders[0].shareBps !== 10_000) throw new Error("Pump fee distribution identity mismatch");
  const keys = tx.transaction.message.accountKeys.map((item) => typeof item === "string" ? item : item.pubkey);
  if (market.quote_mint === NATIVE_MINT.toBase58()) {
    const index = keys.indexOf(treasury.toBase58());
    if (index < 0 || BigInt(tx.meta.postBalances[index]) - BigInt(tx.meta.preBalances[index]) + BigInt(tx.meta.fee) !== amount) throw new Error("Pump SOL fee destination delta mismatch");
  } else {
    const destination = getAssociatedTokenAddressSync(new PublicKey(market.quote_mint), treasury, false, new PublicKey(market.quote_token_program)).toBase58();
    const index = keys.indexOf(destination);
    if (index < 0) throw new Error("Pump token fee destination is missing");
    const read = (rows: TokenBalance[] | undefined) => rows?.find((row) => row.accountIndex === index);
    const before = read(tx.meta.preTokenBalances), after = read(tx.meta.postTokenBalances);
    if (!after || after.mint !== market.quote_mint || after.owner !== treasury.toBase58() || after.programId !== market.quote_token_program || BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0") !== amount) throw new Error("Pump token fee destination delta mismatch");
  }
  return { amountAtoms: amount.toString(), slot: tx.slot, blockTime: new Date(tx.blockTime! * 1000).toISOString(), quoteMint, sharingConfig: sharing.toBase58(), treasury: treasury.toBase58() };
}

async function reconcileOperation(db: SupabaseClient, row: Operation, market: PumpMarket, treasury: PublicKey) {
  if (!["signed", "submitted", "uncertain"].includes(row.status)) return row;
  const signature = row.signature ? String(row.signature) : null, signed = row.signed_transaction ? String(row.signed_transaction) : null;
  if (!signature || !signed) throw new Error("Pump fee operation is missing its signed receipt");
  const exact = await verifyFinalizedSignedTransaction(signature, signed);
  if (!exact) {
    const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
    if (height > Number(row.last_valid_block_height)) {
      const updated = await db.from("pump_fee_operations").update({ status: "uncertain", error_message: "Signed Pump fee transaction expired without finalized proof; archival reconciliation required", updated_at: new Date().toISOString() }).eq("id", row.id).neq("status", "confirmed").select("*").single();
      if (updated.error) throw updated.error;
      return updated.data as Operation;
    }
    await broadcastSignedCheckedTransfer(signed).catch(() => undefined);
    return row;
  }
  const mint = new PublicKey(market.base_mint), sharing = feeSharingConfigPda(mint);
  let proof: Record<string, unknown> = { version: 1, ...exact };
  let amount: string | null = null;
  if (row.kind === "setup") {
    const loaded = await loadSharingConfig(mint);
    if (!loaded) throw new Error("Finalized Pump setup did not create the fee-sharing config");
    assertTreasuryConfig(mint, treasury, loaded);
    const { curve } = await readPumpCurve(market.base_mint, market.market_address);
    if (!curve.creator.equals(sharing)) throw new Error("Pump curve creator did not migrate to its fee-sharing config");
    proof = { ...proof, type: "pump_fee_setup", mint: market.base_mint, sharingConfig: sharing.toBase58(), treasury: treasury.toBase58() };
    const setupProof = await db.from("transaction_proofs").upsert({ launch_id: market.launch_id, kind: "fee_claim", signature, slot: exact.slot, payload: proof, idempotency_key: `pump-setup:${market.launch_id}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (setupProof.error) throw setupProof.error;
  } else {
    const tx = await solanaRpc<ParsedTx | null>("getTransaction", [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    if (!tx) throw new Error("Finalized Pump fee distribution receipt is unavailable");
    if (tx.slot !== exact.slot) throw new Error("Pump fee distribution slot does not match its signed receipt");
    const verified = verifyPumpFeeDistribution(tx, signature, market, treasury, sharing);
    amount = verified.amountAtoms;
    proof = { ...proof, type: "pump_fee_distribution", ...verified };
  }
  const updated = await db.from("pump_fee_operations").update({ status: "confirmed", amount_atoms: amount, slot: exact.slot, proof, error_message: null, updated_at: new Date().toISOString() }).eq("id", row.id).neq("status", "confirmed").select("*").single();
  if (updated.error) throw updated.error;
  return updated.data as Operation;
}

async function creditConfirmedDistributions(db: SupabaseClient, market: PumpMarket) {
  const rows = await db.from("pump_fee_operations").select("*").eq("launch_id", market.launch_id).eq("kind", "distribute").eq("status", "confirmed").order("created_at");
  if (rows.error) throw rows.error;
  for (const row of rows.data ?? []) {
    const existing = await db.from("fee_events").select("id,launch_id").eq("signature", row.signature).eq("asset_mint", market.quote_mint).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.launch_id !== market.launch_id) throw new Error("Pump fee receipt is attributed to another launch");
      continue;
    }
    const proof = row.proof as Record<string, unknown>;
    const result = await db.rpc("credit_pump_shared_fee", { p_operation_id: row.id, p_launch_id: market.launch_id, p_signature: row.signature, p_amount_atoms: row.amount_atoms, p_slot: row.slot, p_block_time: proof.blockTime, p_proof: proof });
    if (result.error) {
      if (String(result.error.message).includes("outside indexed launch history")) return false;
      throw result.error;
    }
  }
  return true;
}

async function quoteVaultBalance(market: PumpMarket, sharing: PublicKey) {
  if (market.quote_mint === NATIVE_MINT.toBase58()) {
    const response = await solanaRpc<{ context: { slot: number }; value: number }>("getBalance", [creatorVaultPda(sharing).toBase58(), { commitment: "finalized" }]);
    return { slot: response.context.slot, amount: BigInt(response.value) };
  }
  const ata = getAssociatedTokenAddressSync(new PublicKey(market.quote_mint), creatorVaultPda(sharing), true, new PublicKey(market.quote_token_program));
  const response = await solanaRpc<{ context: { slot: number }; value: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } | null }>("getAccountInfo", [ata.toBase58(), { commitment: "finalized", encoding: "jsonParsed" }]);
  return { slot: response.context.slot, amount: BigInt(response.value?.data?.parsed?.info?.tokenAmount?.amount ?? "0") };
}

export async function processPumpCreatorFees(db: SupabaseClient, market: PumpMarket, owner: string): Promise<Result> {
  if (process.env.PUMPFUN_ENABLED !== "true" || process.env.DRY_RUN !== "false" || process.env.PAYOUT_MODE !== "server_signer") return { status: "disabled" };
  const treasuryText = process.env.TOPBLAST_TREASURY_ADDRESS;
  if (!treasuryText) throw new Error("TOPBLAST_TREASURY_ADDRESS is required for Pump fee routing");
  const treasury = new PublicKey(treasuryText), mint = new PublicKey(market.base_mint), sharing = feeSharingConfigPda(mint);
  if (createRailwaySigner().publicKey() !== treasuryText) throw new Error("Treasury signer does not match Pump fee recipient");
  const lease = await db.rpc("claim_worker_lease", { p_resource_type: "pump_fee", p_resource_id: market.launch_id, p_owner_id: owner, p_seconds: 90 });
  if (lease.error) throw lease.error;
  if (lease.data !== true) return { status: "lease_busy" };
  const treasuryLease = await db.rpc("claim_worker_lease", { p_resource_type: "payout_treasury", p_resource_id: treasuryText, p_owner_id: owner, p_seconds: 60 });
  if (treasuryLease.error) throw treasuryLease.error;
  if (treasuryLease.data !== true) return { status: "lease_busy" };

  const inFlight = await db.from("pump_fee_operations").select("*").eq("launch_id", market.launch_id).in("status", ["signed", "submitted", "uncertain"]).order("created_at").limit(1).maybeSingle();
  if (inFlight.error) throw inFlight.error;
  if (inFlight.data) {
    const reconciled = await reconcileOperation(db, inFlight.data as Operation, market, treasury);
    if (reconciled.status !== "confirmed") return { status: "awaiting_finality", signature: reconciled.signature ? String(reconciled.signature) : null };
  }

  const { curve } = await readPumpCurve(market.base_mint, market.market_address);
  const loaded = await loadSharingConfig(mint);
  if (curve.creator.equals(treasury)) {
    const setup = await operationFor(db, market.launch_id, "setup", `pump-setup:${market.launch_id}`);
    if (setup.status === "confirmed") throw new Error("Pump setup is marked confirmed but the curve creator was not migrated");
    const quote = await inspectPumpQuoteMint(market.quote_mint);
    const instructions = [
      await PUMP_SDK.createFeeSharingConfig({ creator: treasury, mint, pool: null }),
      await PUMP_SDK.updateFeeSharesV2({ authority: treasury, mint, currentShareholders: [treasury], newShareholders: [{ address: treasury, shareBps: 10_000 }], quoteMint: new PublicKey(market.quote_mint), quoteTokenProgram: quote.tokenProgram }),
    ];
    return advanceOperation(db, setup, treasury, instructions);
  }
  if (!curve.creator.equals(sharing) || !loaded) throw new Error("Pump creator is not the TopBlast treasury or the launch's fee-sharing config");
  assertTreasuryConfig(mint, treasury, loaded);
  if (!await creditConfirmedDistributions(db, market)) return { status: "awaiting_index" };

  const existing = await db.from("pump_fee_operations").select("*").eq("launch_id", market.launch_id).eq("kind", "distribute").in("status", ["planned", "prepared"]).order("created_at").limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  const balance = await quoteVaultBalance(market, sharing);
  if (balance.amount <= 0n) return { status: "idle" };
  const quote = await inspectPumpQuoteMint(market.quote_mint);
  const online = new OnlinePumpSdk(new Connection(solanaRpcUrl(), "confirmed"));
  if (market.quote_mint === NATIVE_MINT.toBase58()) {
    const minimum = await online.getMinimumDistributableFee(mint, treasury, { quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID, payer: treasury });
    if (!minimum.canDistribute) return { status: "idle" };
  }
  const distribution = await online.buildDistributeCreatorFeesInstructions(mint, { quoteMint: new PublicKey(market.quote_mint), quoteTokenProgram: quote.tokenProgram, payer: treasury });
  if (distribution.isGraduated) throw new Error("PumpSwap graduation is not supported yet; tracking and fee distribution are paused");
  if (existing.data) {
    const recovered = await advanceOperation(db, existing.data as Operation, treasury, distribution.instructions);
    return { ...recovered, amountAtoms: balance.amount.toString() } as Result;
  }
  const key = `pump-distribute:${market.launch_id}:${balance.slot}:${balance.amount}`;
  const operation = await operationFor(db, market.launch_id, "distribute", key);
  const result = await advanceOperation(db, operation, treasury, distribution.instructions);
  return { ...result, amountAtoms: balance.amount.toString() } as Result;
}
