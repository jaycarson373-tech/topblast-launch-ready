import { createHash } from "node:crypto";
import { isAddress } from "@solana/addresses";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { solanaRpc } from "@/lib/solana/rpc";
import { inspectLaunchLabMarket, LAUNCHLAB_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/launchlab";
import { decode58, type FinalizedBlockTransaction } from "@/lib/indexer/launchlab-decoder";
import { registerLaunchTracker } from "@/lib/db/launch-repository";
import { getLaunchWallet } from "@/lib/payout/launch-wallet";
import { createLaunchSigner } from "@/lib/payout/launch-signer";

const STONK_PLATFORM = "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7";
const origin = "external_stonk_bundle";
const address = z.string().refine(isAddress);
const profileSchema = z.object({ data: z.object({ network: z.literal("mainnet-beta"), token: z.object({
  mint: address, pool: address, name: z.string().min(1).max(100), symbol: z.string().min(1).max(32),
  quote: z.object({ mint: address, symbol: z.string().min(1).max(32) }),
  imageUrl: z.string().optional(),
}), launch: z.object({ creator: address }) }) });
type CreationTx = FinalizedBlockTransaction & { slot: number; blockTime: number | null; meta: NonNullable<FinalizedBlockTransaction["meta"]> & { preBalances: number[]; postBalances: number[] } };

export function verifyImportedCreation(tx: CreationTx | null, signature: string, mint: string, pool: string, creator: string) {
  if (!tx || tx.meta?.err !== null || tx.transaction.signatures[0] !== signature || !Number.isSafeInteger(tx.slot) || !Number.isSafeInteger(tx.blockTime)) throw new Error("External launch creation receipt is not finalized");
  const keys = tx.transaction.message.accountKeys.map(key => typeof key === "string" ? key : key.pubkey);
  for (const key of [mint, pool]) {
    const index = keys.indexOf(key);
    if (index < 0 || tx.meta.preBalances?.[index] !== 0 || !(tx.meta.postBalances?.[index] > 0)) throw new Error("External receipt did not create this mint and market");
  }
  const allowed = ["initialize_v2", "initialize_with_token_2022"].map(name => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex"));
  const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(group => group.instructions)];
  if (!instructions.some(ix => ix.programId === LAUNCHLAB_PROGRAM && ix.accounts?.includes(mint) && ix.accounts.includes(pool)
    && ix.accounts.includes(creator) && ix.accounts.includes(STONK_PLATFORM) && ix.data
    && allowed.includes(decode58(ix.data).subarray(0, 8).toString("hex")))) throw new Error("External receipt does not contain Stonk's supported creation instruction");
  return { signature, slot: tx.slot, blockTime: tx.blockTime! };
}

async function creationSignature(pool: string) {
  if (process.env.TOPBLAST_LAUNCH_SIGNATURE) return process.env.TOPBLAST_LAUNCH_SIGNATURE;
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const rows: Array<{ signature: string; err: unknown; confirmationStatus: string }> = await solanaRpc("getSignaturesForAddress", [pool, { commitment: "finalized", limit: 1000, ...(before ? { before } : {}) }]);
    if (!Array.isArray(rows) || !rows.length) throw new Error("External market creation history unavailable");
    if (rows.length < 1000) {
      const first = [...rows].reverse().find(row => row.err === null && row.confirmationStatus === "finalized");
      if (!first) throw new Error("External market has no finalized creation receipt");
      return first.signature;
    }
    const next = rows.at(-1)!.signature;
    if (next === before) throw new Error("External launch history pagination did not advance");
    before = next;
  }
  throw new Error("Set TOPBLAST_LAUNCH_SIGNATURE to the real creation receipt for this high-activity market");
}

/** Import only the operator-configured mint. No launch transaction or fake payment receipt is created. */
export async function ensureTopblastCreatorLaunch(db: SupabaseClient, owner: string) {
  const mint = process.env.TOPBLAST_TOKEN_MINT?.trim(), creator = process.env.TOPBLAST_CREATOR_ADDRESS?.trim();
  if (!mint) return { status: "awaiting_mint" };
  if (!isAddress(mint) || !creator || !isAddress(creator) || creator === process.env.TOPBLAST_TREASURY_ADDRESS) throw new Error("TOPBLAST needs its own valid creator wallet and exact mint");
  const lease = await db.rpc("claim_worker_lease", { p_resource_type: "topblast_import", p_resource_id: mint, p_owner_id: owner, p_seconds: 90 });
  if (lease.error) throw lease.error;
  if (lease.data !== true) return { status: "lease_busy" };
  const found = await db.from("launches").select("id,status,creator_wallet,venue_payload,listing_hidden").eq("mint", mint).maybeSingle();
  if (found.error) throw found.error;
  if (found.data && (found.data.creator_wallet !== creator || found.data.venue_payload?.origin !== origin)) throw new Error("This mint already has another launch configuration; it cannot be reassigned to the creator wallet");
  if (found.data && ["active", "paused"].includes(found.data.status)) {
    const wallet = await getLaunchWallet(db, found.data.id);
    createLaunchSigner(wallet.binding).publicKey();
    if (wallet.role !== "topblast_creator") throw new Error("Imported TOPBLAST funding wallet mismatch");
    if (!found.data.listing_hidden) await publishMint(db, mint);
    return { status: found.data.status, launchId: found.data.id };
  }
  const response = await fetch(`https://www.stonkfun.xyz/api/public/v1/tokens/${encodeURIComponent(mint)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Stonk has not published this mint yet (${response.status}); import will retry`);
  const { data } = profileSchema.parse(await response.json());
  const token = data.token;
  if (token.mint !== mint || data.launch.creator !== creator) throw new Error("Stonk token and configured creator do not match");
  const signature = await creationSignature(token.pool);
  const tx = await solanaRpc<CreationTx | null>("getTransaction", [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
  const proof = verifyImportedCreation(tx, signature, mint, token.pool, creator);
  const market = await inspectLaunchLabMarket({ mint, pool: token.pool, quoteMint: token.quote.mint, creator, feeRecipient: creator, launchSignature: signature });
  if (market.platformConfigAddress !== STONK_PLATFORM || market.launchSlot !== proof.slot || market.quoteTokenProgram !== TOKEN_PROGRAM) throw new Error("External token has an unsupported market, quote asset or launch slot");
  const binding = { launchId: found.data?.id ?? "pending", mint, creator, venue: "stonkfun", treasury: creator, rewardMint: token.quote.mint, immutable: true };
  createLaunchSigner(binding).publicKey();
  let image = "";
  try { const url = new URL(token.imageUrl ?? ""); if (url.protocol === "https:" && !url.username && !url.password && !url.port) image = url.href; } catch { /* No fabricated logo. */ }
  let id = found.data?.id as string | undefined;
  if (!id) {
    const inserted = await db.from("launches").insert({
      venue: "stonkfun", creator_wallet: creator, name: token.name, symbol: token.symbol, image_url: image,
      mint, market_address: token.pool, quote_mint: token.quote.mint, quote_symbol: token.quote.symbol,
      status: "prepared", is_test: false, listing_hidden: true, launch_signature: signature,
      signed_quote_hash: createHash("sha256").update(`${origin}:${mint}:${signature}`).digest("hex"),
      venue_payload: { origin, submittedByPlatform: false, registration: "verified_market_import", creationProof: proof },
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    id = inserted.data.id;
  }
  const config = await db.from("launch_configs").select("*").eq("launch_id", id).maybeSingle();
  if (config.error) throw config.error;
  if (!config.data) {
    const saved = await db.from("launch_configs").insert({ launch_id: id, fee_tier: "1%", topblast_percent: 90, creator_percent: 0, protocol_percent: 10, reward_asset_mint: token.quote.mint, treasury_address: creator, immutable: true });
    if (saved.error) throw saved.error;
  } else if (!config.data.immutable || config.data.treasury_address !== creator || config.data.reward_asset_mint !== token.quote.mint || config.data.topblast_percent !== 90 || config.data.creator_percent !== 0 || config.data.protocol_percent !== 10) throw new Error("Imported launch's permanent reward configuration differs; it will not be overwritten");
  const association = await db.from("launch_creators").upsert({ launch_id: id, creator_wallet: creator }, { onConflict: "launch_id,creator_wallet", ignoreDuplicates: true });
  if (association.error) throw association.error;
  if (!await registerLaunchTracker(id!, { mint, pool: token.pool, quoteMint: token.quote.mint, creator, launchSignature: signature, venue: "stonkfun" })) throw new Error("External token exists; tracker registration will retry without another launch or payment");
  const activated = await db.from("launches").update({ status: "active", listing_hidden: false, activated_at: new Date().toISOString() }).eq("id", id).eq("status", "prepared");
  if (activated.error) throw activated.error;
  await publishMint(db, mint);
  return { status: "active", launchId: id };
}

async function publishMint(db: SupabaseClient, mint: string) {
  const result = await db.from("system_config").upsert({ key: "topblast_registered_mint", value: mint, updated_at: new Date().toISOString() });
  if (result.error) throw result.error;
}
