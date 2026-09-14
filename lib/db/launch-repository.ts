import "server-only";
import { createHash } from "node:crypto";
import { getAdminDb } from "@/lib/db/server";
import type { LaunchDraft, LaunchSummary } from "@/lib/types";
import type { SubmittedLaunch, VenueLaunch } from "@/lib/venue/launch-venue-adapter";

export async function createLaunchDraft(draft: LaunchDraft, signedQuote: string): Promise<string> {
  const db = getAdminDb();
  const { data, error } = await db.from("launches").insert({
    creator_wallet: draft.creatorWallet,
    name: draft.name,
    symbol: draft.symbol,
    description: draft.description,
    image_url: draft.logo,
    website_url: draft.website,
    x_url: draft.twitter,
    telegram_url: draft.telegram,
    quote_mint: draft.quoteMint,
    quote_symbol: draft.quoteSymbol,
    venue: "stonkfun",
    status: "prepared",
    signed_quote_hash: createHash("sha256").update(signedQuote).digest("hex"),
  }).select("id").single();
  if (error) throw error;
  const launchId = String(data.id);
  const { error: configError } = await db.from("launch_configs").insert({
    launch_id: launchId,
    fee_tier: draft.feeTier,
    topblast_percent: draft.allocation.topblastPercent,
    creator_percent: draft.allocation.creatorPercent,
    protocol_percent: draft.allocation.protocolPercent,
    reward_asset_mint: draft.quoteMint,
    immutable: true,
  });
  if (configError) throw configError;
  const { error: creatorError } = await db.from("launch_creators").insert({ launch_id: launchId, creator_wallet: draft.creatorWallet });
  if (creatorError) throw creatorError;
  return launchId;
}

export async function applyVenueLaunch(launchId: string, result: SubmittedLaunch | VenueLaunch): Promise<void> {
  const db = getAdminDb();
  const completed = result.status === "completed" && result.mint && result.pool;
  const values = {
    status: completed ? "active" : result.status,
    payment_signature: result.paymentSignature || null,
    mint: result.mint ?? null,
    market_address: result.pool ?? null,
    launch_signature: result.signature ?? null,
    activated_at: completed ? new Date().toISOString() : null,
    venue_payload: result.raw,
  };
  const { error } = await db.from("launches").update(values).eq("id", launchId);
  if (error) throw error;
  if (completed) {
    const { data: launch, error: launchError } = await db.from("launches").select("quote_mint").eq("id", launchId).single();
    if (launchError) throw launchError;
    const { error: marketError } = await db.from("tracked_markets").upsert({
      launch_id: launchId, venue: "stonkfun", market_address: result.pool,
      base_mint: result.mint, quote_mint: launch.quote_mint, active: true,
    }, { onConflict: "launch_id" });
    if (marketError) throw marketError;
  }
}

export async function verifyLaunchQuote(launchId: string, signedQuote: string): Promise<void> {
  const hash = createHash("sha256").update(signedQuote).digest("hex");
  const { data, error } = await getAdminDb().from("launches").select("signed_quote_hash,status").eq("id", launchId).single();
  if (error) throw error;
  if (data.signed_quote_hash !== hash) throw new Error("Signed quote does not match prepared launch");
  if (!["prepared", "processing"].includes(data.status)) throw new Error(`Launch is already ${data.status}`);
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
  }));
}
