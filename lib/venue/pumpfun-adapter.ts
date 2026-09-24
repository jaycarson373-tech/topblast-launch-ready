import { randomUUID } from "node:crypto";
import { PUMP_SDK, bondingCurvePda, creatorVaultPda } from "@/lib/solana/pump-sdk";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { getAdminDb } from "@/lib/db/server";
import { solanaRpc } from "@/lib/solana/rpc";
import { launchReviewExpiry } from "@/lib/solana/launch-expiry";
import { PUMP_SOL_MINT, PUMP_PROGRAM_ID, readPumpCurve, pumpCreationAvailable, assertPumpMainnet, inspectPumpQuoteMint } from "@/lib/solana/pumpfun";
import { listOfficialPumpPairs, officialPumpPair } from "./pump-pairs";
import { broadcastSignedCheckedTransfer } from "@/lib/solana/checked-transfers";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import type { LaunchDraft } from "@/lib/types";
import type { LaunchVenueAdapter, PreparedLaunch, SubmittedLaunch, PreparedFeeClaim } from "./launch-venue-adapter";

export function validatePumpImage(data: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new Error("Use a PNG, JPEG, or WebP image");
  const bytes = Buffer.from(match[2], "base64");
  const valid = match[1] === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid || bytes.length > 2_000_000) throw new Error("Invalid image bytes or image exceeds 2 MB");
  return { contentType: match[1], bytes };
}

export class PumpFunAdapter implements LaunchVenueAdapter {
  readonly venue = "pumpfun";
  async createLaunch(input: LaunchDraft): Promise<PreparedLaunch> {
    if (!input.pumpMint) throw new Error("Pump.fun requires a browser-generated mint address");
    if (!await pumpCreationAvailable()) throw new Error("Pump.fun has disabled token creation. Try again when the venue reopens it.");
    validatePumpImage(input.logo);
    const user = new PublicKey(input.creatorWallet), mint = new PublicKey(input.pumpMint);
    // The API readiness gate requires the treasury in production. Falling back
    // to the user keeps the low-level adapter independently testable.
    const feeRecipientValue = process.env.TOPBLAST_TREASURY_ADDRESS ?? input.creatorWallet;
    const feeRecipient = new PublicKey(feeRecipientValue);
    if (!PublicKey.isOnCurve(mint.toBytes()) || !PublicKey.isOnCurve(user.toBytes()) || !PublicKey.isOnCurve(feeRecipient.toBytes()) || mint.equals(user) || mint.equals(feeRecipient)) throw new Error("Invalid user, fee recipient, or new mint signer");
    const metadataId = randomUUID();
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://topblast-stonkfun-launchpad.vercel.app").origin;
    const uri = `${origin}/api/metadata/${metadataId}`;
    const metadata = { name: input.name, symbol: input.symbol, description: input.description, image: `${uri}?image=1`, external_url: input.website, twitter: input.twitter, telegram: input.telegram };
    const { error } = await getAdminDb().from("launch_metadata").insert({ id: metadataId, metadata, image_data: input.logo });
    if (error) throw error;
    const pair = await this.getPair(input.quoteMint);
    if (!pair?.launchable) throw new Error("This pair is not currently supported for Pump.fun creation");
    const quote = await inspectPumpQuoteMint(input.quoteMint);
    const create = await PUMP_SDK.createV2Instruction({ mint, name: input.name, symbol: input.symbol, uri, creator: feeRecipient, user, mayhemMode: false, cashback: false, holderReward: false, ...(input.quoteMint === PUMP_SOL_MINT ? {} : { quoteMint: new PublicKey(input.quoteMint), quoteTokenProgram: quote.tokenProgram }) });
    const latest = await solanaRpc<{ context: { slot: number }; value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    if (!Number.isSafeInteger(latest.context?.slot)) throw new Error("Launch blockhash context unavailable");
    const transaction = new Transaction({ feePayer: user, recentBlockhash: latest.value.blockhash })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), create);
    const wire = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const before = await solanaRpc<{ context: { slot: number }; value: number }>("getBalance", [input.creatorWallet, { commitment: "confirmed", minContextSlot: latest.context.slot }]);
    if (!Number.isSafeInteger(before.value) || !Number.isSafeInteger(before.context?.slot)) throw new Error("Cannot verify creator balance for simulation");
    const simulated = await solanaRpc<{ context: { slot: number }; value: { err: unknown; accounts?: Array<{ lamports: number } | null> } }>("simulateTransaction", [wire, { encoding: "base64", commitment: "confirmed", minContextSlot: Math.max(before.context.slot, latest.context.slot), sigVerify: false, accounts: { encoding: "base64", addresses: [input.creatorWallet] } }]);
    if (simulated.value?.err !== null) throw new Error(`Pump.fun creation simulation failed or was incomplete: ${JSON.stringify(simulated.value?.err)}. Check creator SOL balance.`);
    if (!Number.isSafeInteger(simulated.context?.slot)) throw new Error("Simulation context is unavailable");
    const balance = await solanaRpc<{ value: number }>("getBalance", [input.creatorWallet, { commitment: "confirmed", minContextSlot: simulated.context.slot }]);
    const after = simulated.value.accounts?.[0]?.lamports;
    if (balance.value !== before.value) throw new Error("Creator balance changed during simulation. Prepare a fresh transaction review.");
    if (!Number.isSafeInteger(after) || after! < 0 || after! >= before.value) throw new Error("Cannot verify Pump.fun creation cost");
    const lamports = String(before.value - after!);
    const expiresAt = await launchReviewExpiry(latest.value.lastValidBlockHeight);
    return { signedQuote: JSON.stringify({ venue: this.venue, mint: input.pumpMint, pool: bondingCurvePda(mint).toBase58(), quoteMint: input.quoteMint, feeRecipient: feeRecipient.toBase58(), metadataId, lastValidBlockHeight: latest.value.lastValidBlockHeight }), paymentTransaction: wire, payment: { lamports, sol: Number(lamports) / 1e9, recipient: PUMP_PROGRAM_ID.toBase58() }, expiresAt, raw: { fundingMode: "pump_per_mint_fee_sharing", rewardAsset: input.quoteSymbol, feeRecipient: feeRecipient.toBase58(), nativeHolderRewards: false, simulation: "passed", costDescription: "Simulated SOL debit including network fee and account creation. No initial token purchase. TopBlast activates the official per-mint Pump fee-sharing route after finalization." } };
  }
  async submitLaunch(input: { signedQuote: string; signedTransaction: string; logo: string }): Promise<SubmittedLaunch> {
    // The shared submission service has already bound and validated this exact message.
    const signature = paymentSignatureFromTransaction(Buffer.from(input.signedTransaction, "base64"));
    return this.getLaunch(signature);
  }
  async getLaunch(signature: string): Promise<SubmittedLaunch> {
    await assertPumpMainnet();
    const { data: receipt, error } = await getAdminDb().from("launch_submission_receipts").select("signed_quote,signed_payment_transaction").eq("payment_signature", signature).single();
    if (error) throw error;
    const quote = JSON.parse(receipt.signed_quote) as { venue: string; mint: string; pool: string; feeRecipient?: string; lastValidBlockHeight: number };
    if (quote.venue !== this.venue) throw new Error("Pump.fun receipt venue mismatch");
    const tx = await solanaRpc<{ slot: number; meta: { err: unknown } | null; transaction: [string, string] } | null>("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
    if (tx) {
      if (!tx.meta) throw new Error("Pump.fun transaction metadata unavailable");
      if (tx.transaction[0] !== receipt.signed_payment_transaction) throw new Error("Pump.fun finalized transaction does not match the receipt");
      return { status: tx.meta.err ? "failed" : "completed", paymentSignature: signature, mint: quote.mint, pool: quote.pool, signature, raw: { slot: tx.slot, error: tx.meta.err, feeRecipient: quote.feeRecipient } };
    }
    const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
    const status = await solanaRpc<{ value: Array<{ err: unknown; confirmationStatus: string } | null> }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    if (!status.value[0] && height > quote.lastValidBlockHeight) return { status: "failed", paymentSignature: signature, raw: { reason: "Expired without landing; no new payment was submitted" } };
    // Rebroadcast only identical signed bytes while the original blockhash is valid.
    if (height <= quote.lastValidBlockHeight && receipt.signed_payment_transaction) await broadcastSignedCheckedTransfer(receipt.signed_payment_transaction).catch(() => undefined);
    return { status: "processing", paymentSignature: signature, raw: { confirmationStatus: status.value[0]?.confirmationStatus ?? "pending" } };
  }
  async getPair(mint: string) {
    const listed = await officialPumpPair(mint);
    if (!listed) return null;
    const quote = await inspectPumpQuoteMint(mint);
    return { ...listed, decimals: quote.decimals, launchable: await pumpCreationAvailable() };
  }
  async listPairs() { return listOfficialPumpPairs(); }
  async getCreatorFees(mint: string) {
    const { curve } = await readPumpCurve(mint, bondingCurvePda(new PublicKey(mint)).toBase58());
    const vault = creatorVaultPda(curve.creator).toBase58();
    return { claimable: null, reason: "TopBlast uses Pump.fun’s official per-mint fee-sharing config. The worker distributes and credits only finalized receipts for this mint.", scope: "launch", raw: { creator: curve.creator.toBase58(), vault } };
  }
  async getMarketData(mint: string, expectedPool: string) {
    await readPumpCurve(mint, expectedPool);
    return { priceUsd: null, marketCapUsd: null, volume24hUsd: null, liquidityUsd: null, raw: { reason: "USD metrics unavailable; the finalized selected-quote chart is provided separately" } };
  }
  async prepareCreatorFeeClaim(): Promise<PreparedFeeClaim> { throw new Error("Pump fee sharing is operated by the isolated TopBlast worker after per-mint setup"); }
  async claimCreatorFees(): Promise<{ signature: string; alreadySubmitted: boolean; raw: Record<string, unknown> }> { throw new Error("Pump per-mint fee sharing is worker-managed and idempotent"); }
}
