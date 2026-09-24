import { createHash } from "node:crypto";
import { getAdminDb } from "@/lib/db/server";
import type { LaunchDraft, LaunchSummary } from "@/lib/types";
import type { SubmittedLaunch, VenueLaunch } from "@/lib/venue/launch-venue-adapter";
import { addHeliusWebhookAddresses } from "@/lib/indexer/helius-webhook";
import { inspectLaunchLabMarket } from "@/lib/solana/launchlab";
import { VersionedTransaction } from "@solana/web3.js";
import { inspectPumpMarket } from "@/lib/solana/pumpfun";

export async function createLaunchDraft(draft: LaunchDraft, signedQuote: string, paymentTransaction: string, expiresAt?: string): Promise<string> {
  const transaction = VersionedTransaction.deserialize(Buffer.from(paymentTransaction, "base64"));
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== draft.creatorWallet) throw new Error("Launch fee payer does not match the creator wallet");
  const paymentMessageHash = createHash("sha256").update(transaction.message.serialize()).digest("hex");
  const db = getAdminDb();
  const { data, error } = await db.from("launches").insert({
    creator_wallet: draft.creatorWallet,
    is_test: draft.isTest === true,
    public_test_listing: draft.isTest === true && process.env.CONTROLLED_TEST_LISTINGS_PUBLIC === "true",
    name: draft.name,
    symbol: draft.symbol,
    description: draft.description,
    image_url: draft.logo,
    website_url: draft.website,
    x_url: draft.twitter,
    telegram_url: draft.telegram,
    quote_mint: draft.quoteMint,
    quote_symbol: draft.quoteSymbol,
    venue: draft.venue ?? "stonkfun",
    status: "prepared",
    signed_quote_hash: createHash("sha256").update(signedQuote).digest("hex"),
    payment_message_hash: paymentMessageHash,
    quote_expires_at: expiresAt ?? new Date(Date.now() + 90_000).toISOString(),
  }).select("id").single();
  if (error) throw error;
  const launchId = String(data.id);
  const { error: configError } = await db.from("launch_configs").insert({
    launch_id: launchId,
    // Legacy schema compatibility only. New direct launches display the verified
    // venue rates in their review, never this old selectable fee-tier label.
    fee_tier: draft.feeTier,
    topblast_percent: draft.allocation.topblastPercent,
    creator_percent: draft.allocation.creatorPercent,
    protocol_percent: draft.allocation.protocolPercent,
    reward_asset_mint: draft.quoteMint,
    treasury_address: process.env.TOPBLAST_TREASURY_ADDRESS,
    immutable: true,
  });
  if (configError) throw configError;
  const { error: creatorError } = await db.from("launch_creators").insert({ launch_id: launchId, creator_wallet: draft.creatorWallet });
  if (creatorError) throw creatorError;
  const { error: receiptError } = await db.from("launch_submission_receipts").insert({
    launch_id: launchId, signed_quote: signedQuote, unsigned_payment_transaction: paymentTransaction,
    payment_message_hash: paymentMessageHash,
  });
  if (receiptError) throw receiptError;
  return launchId;
}

export async function applyVenueLaunch(launchId: string, result: SubmittedLaunch | VenueLaunch): Promise<"active" | "failed" | "pending"> {
  const db = getAdminDb();
  const completed = result.status === "completed" && result.mint && result.pool;
  const values = {
    status: completed ? "active" : result.status,
    tracker_status: completed ? "registering" : "pending",
    payment_signature: result.paymentSignature || null,
    mint: result.mint ?? null,
    market_address: result.pool ?? null,
    launch_signature: result.signature ?? null,
    activated_at: completed ? new Date().toISOString() : null,
    venue_payload: result.raw,
  };
  const { error } = await db.from("launches").update(values).eq("id", launchId).in("status", ["prepared", "processing"]);
  if (error) throw error;
  await db.from("launch_submission_receipts").update({ status: result.status, last_error: result.status === "failed" ? (typeof result.raw?.reason === "string" ? result.raw.reason : "Launch transaction failed; see the saved onchain receipt") : null, updated_at: new Date().toISOString() }).eq("launch_id", launchId);
  if (completed) {
    const { data: launch, error: launchError } = await db.from("launches").select("venue,quote_mint,creator_wallet,launch_signature").eq("id", launchId).single();
    if (launchError) throw launchError;
    const registered = await registerLaunchTracker(launchId, {
      mint: result.mint!, pool: result.pool!, quoteMint: launch.quote_mint,
      creator: launch.creator_wallet, launchSignature: result.signature ?? launch.launch_signature, venue: launch.venue,
    });
    return registered ? "active" : "failed";
  }
  return "pending";
}

export async function registerLaunchTracker(launchId: string, input?: { mint: string; pool: string; quoteMint: string; creator: string; launchSignature?: string | null; venue?: string }): Promise<boolean> {
  const db = getAdminDb();
  const { data: existing, error: existingError } = await db.from("tracked_markets").select("active").eq("launch_id", launchId).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.active) return true;
  let source = input;
  if (!source) {
    const { data, error } = await db.from("launches").select("venue,mint,market_address,quote_mint,creator_wallet,launch_signature").eq("id", launchId).single();
    if (error) throw error;
    if (!data.mint || !data.market_address) throw new Error("Launch mint and market are not available");
    source = { mint: data.mint, pool: data.market_address, quoteMint: data.quote_mint, creator: data.creator_wallet, launchSignature: data.launch_signature, venue: data.venue };
  }
  await db.from("launches").update({ tracker_status: "registering", tracker_error: null }).eq("id", launchId);
  try {
    let feeRecipient: string | undefined;
    if (source.venue !== "pumpfun") {
      const receiver = await db.from("stonk_fee_receivers").select("address,treasury_address").eq("mint", source.mint).maybeSingle();
      if (receiver.error) throw receiver.error;
      if (receiver.data) {
        if (receiver.data.treasury_address !== process.env.TOPBLAST_TREASURY_ADDRESS) throw new Error("Stonk receiver treasury mismatch");
        feeRecipient = receiver.data.address;
      }
    }
    const market = await (source.venue === "pumpfun" ? inspectPumpMarket(source) : inspectLaunchLabMarket({ ...source, feeRecipient }));
    await addHeliusWebhookAddresses([source.mint, source.pool]);
    const { error: marketError } = await db.from("tracked_markets").upsert({
      launch_id: launchId, venue: source.venue ?? "stonkfun", market_address: source.pool,
      base_mint: source.mint, quote_mint: source.quoteMint, active: true,
      base_decimals: market.baseDecimals, quote_decimals: market.quoteDecimals,
      program_id: market.programId, launch_slot: market.launchSlot,
      launch_signature: source.launchSignature ?? null,
      config_address: market.configAddress, platform_config_address: market.platformConfigAddress,
      authority_address: market.authorityAddress, creator_address: market.creatorAddress,
      base_vault: market.baseVault, quote_vault: market.quoteVault,
      base_token_program: market.baseTokenProgram, quote_token_program: market.quoteTokenProgram,
      last_indexed_slot: Math.max(0, market.launchSlot - 1), last_indexed_blockhash: null,
      history_complete: false, price_status: "pending", tracker_error: null,
    }, { onConflict: "launch_id" });
    if (marketError) throw marketError;
    const { error: launchError } = await db.from("launches").update({ tracker_status: "active", tracker_error: null }).eq("id", launchId);
    if (launchError) throw launchError;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tracker registration failed";
    await db.from("tracked_markets").upsert({
      launch_id: launchId, venue: source.venue ?? "stonkfun", market_address: source.pool,
      base_mint: source.mint, quote_mint: source.quoteMint, active: false, tracker_error: message,
    }, { onConflict: "launch_id" });
    await db.from("launches").update({ tracker_status: "failed", tracker_error: message }).eq("id", launchId);
    await db.from("system_config").upsert({ key: `tracker_sync_error:${launchId}`, value: { message, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
    return false;
  }
}

export async function verifyLaunchQuote(launchId: string, signedQuote: string): Promise<{ paymentMessageHash: string; creatorWallet: string; isTest: boolean }> {
  const hash = createHash("sha256").update(signedQuote).digest("hex");
  const { data, error } = await getAdminDb().from("launches").select("signed_quote_hash,status,payment_message_hash,creator_wallet,quote_expires_at,is_test").eq("id", launchId).single();
  if (error) throw error;
  if (data.signed_quote_hash !== hash) throw new Error("Signed quote does not match prepared launch");
  if (!["prepared", "processing"].includes(data.status)) throw new Error(`Launch is already ${data.status}`);
  // Direct creation is bound to the exact reviewed message and its onchain
  // blockhash lifetime. Persist a late wallet signature so recovery can determine
  // whether it landed or expired. The UI deadline must not orphan this receipt.
  let direct = false;
  try { const quote = JSON.parse(signedQuote); direct = quote.venue === "pumpfun" || (quote.venue === "stonkfun" && quote.method === "launchlab"); } catch { /* Upstream signed quote. */ }
  if (!direct && data.status === "prepared" && data.quote_expires_at && new Date(data.quote_expires_at).getTime() < Date.now()) throw new Error("Launch quote expired. Prepare a fresh review before signing.");
  if (!data.payment_message_hash) throw new Error("Prepared payment message is missing");
  return { paymentMessageHash: data.payment_message_hash, creatorWallet: data.creator_wallet, isTest: data.is_test === true };
}

export async function verifyLaunchPayment(launchId: string, paymentSignature: string): Promise<void> {
  const { data, error } = await getAdminDb().from("launches").select("payment_signature,status").eq("id", launchId).single();
  if (error) throw error;
  if (!data.payment_signature || data.payment_signature !== paymentSignature) throw new Error("Payment signature does not belong to this launch");
  if (!["processing", "active"].includes(data.status)) throw new Error(`Launch is ${data.status}`);
}

export async function listLaunches(): Promise<LaunchSummary[]> {
  const { data, error } = await getAdminDb().from("launch_explore").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, mint: row.mint, name: row.name, symbol: row.symbol,
    quoteSymbol: row.quote_symbol, creatorWallet: row.creator_wallet,
    marketCapUsd: row.market_cap_usd, volume24hUsd: row.volume_24h_usd,
    liquidityUsd: row.liquidity_usd, priceUsd: row.price_usd,
    totalRewardedAtoms: String(row.total_rewarded_atoms ?? "0"),
    eligibleWallets: Number(row.eligible_wallets ?? 0), createdAt: row.created_at, status: row.status,
    imageUrl: row.image_url, trackerStatus: row.tracker_status, totalFundedAtoms: String(row.total_funded_atoms ?? "0"),
    venue: row.venue, isTest: row.is_test, currentEpoch: row.current_epoch, quoteDecimals: row.quote_decimals,
    availableRewardAtoms: row.available_reward_atoms == null ? null : String(row.available_reward_atoms),
  }));
}

// Persist the payment ID before the upstream network request. A lost response
// can then be recovered by status lookup without asking the wallet to pay again.
export async function bindLaunchPayment(launchId: string, signature: string, signedTransaction: string): Promise<void> {
  const db = getAdminDb();
  const { error } = await db.rpc("bind_launch_payment", { p_launch_id: launchId, p_signature: signature, p_signed_transaction: signedTransaction });
  if (error) throw error;
  await verifyLaunchPayment(launchId, signature);
}

export async function getBoundLaunchSubmission(launchId: string) {
  const db = getAdminDb();
  const { data, error } = await db.from("launch_submission_receipts").select("*").eq("launch_id", launchId).single();
  if (error) throw error;
  if (!data.signed_payment_transaction || !data.payment_signature) throw new Error("Launch payment has not been signed");
  await db.from("launch_submission_receipts").update({ status: "submitted", attempts: data.attempts + 1, last_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("launch_id", launchId).eq("payment_signature", data.payment_signature);
  return data as { signed_quote: string; signed_payment_transaction: string; payment_signature: string };
}

export async function recordLaunchSubmissionError(launchId: string, message: string) {
  await getAdminDb().from("launch_submission_receipts").update({ status: "processing", last_error: message, updated_at: new Date().toISOString() }).eq("launch_id", launchId).in("status", ["prepared", "submitted", "processing"]);
}
