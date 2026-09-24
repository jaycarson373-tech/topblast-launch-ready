import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getLaunchWallet } from "@/lib/payout/launch-wallet";
import { createLaunchSigner } from "@/lib/payout/launch-signer";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";
import { solanaRpc } from "@/lib/solana/rpc";
import { inspectLaunchLabMarket, LAUNCHLAB_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/launchlab";
import { routeFromVenueReceipt, verifyCreatorReceipt, type FundingTransaction } from "@/lib/funding/creator-receipt";

interface Market {
  launch_id: string; base_mint: string; quote_mint: string; market_address: string;
  creator_address: string; launch_slot: number | string; last_indexed_slot: number | string; quote_decimals: number;
}
type SignatureRow = { signature: string; slot: number; err: unknown; confirmationStatus?: string };

/** Automatic fee receipts for the one dedicated TOPBLAST creator wallet only.
 * No estimate from volume, wallet balance, donations or pool sell proceeds. */
export async function processTopblastCreatorFees(db: SupabaseClient, market: Market, owner: string) {
  if (process.env.DRY_RUN !== "false" || process.env.PAYOUT_MODE !== "server_signer") return { status: "disabled" };
  const wallet = await getLaunchWallet(db, market.launch_id);
  if (wallet.role !== "topblast_creator" || market.base_mint !== wallet.binding.mint || market.creator_address !== wallet.address) throw new Error("Dedicated creator funding identity mismatch");
  if (wallet.status !== "active") return { status: "paused" };
  // Verify availability, but never sign or submit a transaction in this reader.
  createLaunchSigner(wallet.binding).publicKey();
  const lease = await db.rpc("claim_worker_lease", { p_resource_type: "creator_funding", p_resource_id: market.launch_id, p_owner_id: owner, p_seconds: 90 });
  if (lease.error) throw lease.error;
  if (lease.data !== true) return { status: "lease_busy" };
  const inspected = await inspectLaunchLabMarket({ pool: market.market_address, mint: market.base_mint, quoteMint: market.quote_mint, creator: wallet.address, feeRecipient: wallet.address });
  if (inspected.quoteTokenProgram !== TOKEN_PROGRAM || inspected.quoteDecimals !== market.quote_decimals) throw new Error("Dedicated creator reward asset must be the verified classic SPL quote mint");

  // Stonk aggregates by creator. A creator with another LaunchLab pool cannot
  // use this single-token shortcut. The platform's other launches keep their
  // per-launch receiver wallets and are unaffected by this check.
  const pools = await solanaRpc<Array<{ pubkey: string; account: { owner: string } }>>("getProgramAccounts", [LAUNCHLAB_PROGRAM, {
    commitment: "finalized", encoding: "base64", dataSlice: { offset: 0, length: 0 },
    filters: [{ dataSize: 429 }, { memcmp: { offset: 333, bytes: wallet.address } }],
  }]);
  if (!Array.isArray(pools) || pools.length !== 1 || pools[0].pubkey !== market.market_address || pools[0].account.owner !== LAUNCHLAB_PROGRAM) {
    throw new Error("TOPBLAST creator must have exactly one verified LaunchLab pool; aggregated multi-token fees cannot be attributed");
  }
  const fees = await new StonkFunAdapter().getCreatorFees(market.base_mint);
  const forwarded = fees.forwarding;
  if (fees.raw?.creator !== wallet.address || !forwarded || forwarded.quoteMint !== market.quote_mint || forwarded.decimals !== market.quote_decimals) throw new Error("Stonk creator fee entitlement or quote asset could not be verified");
  if (!forwarded.lastSignature || BigInt(forwarded.creatorQuoteForwardedAtoms) === 0n) return { status: "awaiting_venue_forward" };
  const destination = getAssociatedTokenAddressSync(new PublicKey(market.quote_mint), new PublicKey(wallet.address)).toBase58();
  const venueTx = await solanaRpc<FundingTransaction | null>("getTransaction", [forwarded.lastSignature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
  if (!venueTx) return { status: "awaiting_finality" };
  const route = routeFromVenueReceipt(venueTx, destination, market.quote_mint, market.quote_decimals, wallet.address, Number(market.launch_slot));
  verifyCreatorReceipt(venueTx, forwarded.lastSignature, route);

  const seen = new Set<string>();
  let creditedAtoms = 0n;
  for (let offset = 0; ; offset += 1000) {
    const prior = await db.from("fee_events").select("signature,amount_atoms").eq("launch_id", market.launch_id).eq("source", "stonkfun_forward").eq("status", "confirmed").order("id").range(offset, offset + 999);
    if (prior.error) throw prior.error;
    for (const row of prior.data ?? []) { seen.add(row.signature); creditedAtoms += BigInt(row.amount_atoms); }
    if (!prior.data || prior.data.length < 1000) break;
  }
  if (creditedAtoms > BigInt(forwarded.creatorQuoteForwardedAtoms)) throw new Error("Credited receipts exceed Stonk's current forwarding total; reconciliation required");
  const latest = await db.from("transaction_proofs").select("slot").eq("launch_id", market.launch_id).eq("kind", "fee_forward").order("slot", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw latest.error;
  const floor = Math.max(Number(market.launch_slot), Number(latest.data?.slot ?? 0));
  const rows: SignatureRow[] = [];
  let before: string | undefined, complete = false;
  for (let page = 0; page < 10; page++) {
    const batch = await solanaRpc<SignatureRow[]>("getSignaturesForAddress", [destination, { commitment: "finalized", limit: 1000, ...(before ? { before } : {}) }]);
    if (!Array.isArray(batch) || batch.some(row => !Number.isSafeInteger(row.slot))) throw new Error("Dedicated creator funding history unavailable");
    rows.push(...batch.filter(row => row.slot >= floor));
    if (batch.length < 1000 || batch.at(-1)!.slot < floor) { complete = true; break; }
    const next = batch.at(-1)!.signature;
    if (next === before) throw new Error("Funding pagination made no progress");
    before = next;
  }
  if (!complete) throw new Error("Dedicated creator funding history exceeds one safe scan; no new receipts credited");
  let credited = 0;
  for (const row of rows.sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))) {
    if (row.err !== null || seen.has(row.signature)) continue;
    if (row.confirmationStatus !== "finalized") throw new Error("Funding signature is not finalized");
    if (row.slot > Number(market.last_indexed_slot)) return { status: "awaiting_index", credited };
    const tx = row.signature === forwarded.lastSignature ? venueTx : await solanaRpc<FundingTransaction | null>("getTransaction", [row.signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
    if (!tx) throw new Error("Finalized funding transaction is unavailable; retry without advancing");
    // Ignore ordinary deposits and payouts. Only the venue-authenticated route
    // qualifies; malformed movement on that route fails closed.
    const instructions = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap(group => group.instructions)];
    if (!instructions.some(ix => ix.programId === TOKEN_PROGRAM && ix.parsed?.info?.source === route.source && ix.parsed.info.destination === destination)) continue;
    const proof = verifyCreatorReceipt(tx, row.signature, route);
    if (proof.slot !== row.slot || creditedAtoms + BigInt(proof.amountAtoms) > BigInt(forwarded.creatorQuoteForwardedAtoms)) throw new Error("Funding receipts exceed Stonk's verified forwarding total");
    const saved = await db.rpc("credit_stonk_forwarded_fee", {
      p_launch_id: market.launch_id, p_signature: proof.signature, p_amount_atoms: proof.amountAtoms,
      p_slot: proof.slot, p_block_time: new Date(proof.blockTime * 1000).toISOString(),
      p_proof: { ...proof, fundingSource: "dedicated_creator_venue_forward", venueLastSignature: forwarded.lastSignature, venueReportedForwardedAtoms: forwarded.creatorQuoteForwardedAtoms, solePool: market.market_address },
    });
    if (saved.error) throw saved.error;
    creditedAtoms += BigInt(proof.amountAtoms); seen.add(proof.signature);
    if (saved.data === true) credited++;
  }
  const unverifiedAtoms = BigInt(forwarded.creatorQuoteForwardedAtoms) - creditedAtoms;
  return { status: unverifiedAtoms > 0n ? "reconciliation_required" : credited ? "credited" : "idle", credited, unverifiedAtoms: unverifiedAtoms.toString() };
}
