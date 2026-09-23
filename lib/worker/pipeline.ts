import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeFinalizedLaunchLabTransaction, type FinalizedBlockTransaction } from "@/lib/indexer/launchlab-decoder";
import { buildEpochPlan } from "@/lib/rewards/epoch";
import { canonicalEpochPrice } from "@/lib/rewards/price-policy";
import { observeLaunchLabPrice } from "@/lib/solana/launchlab";
import { verifyFinalizedSignedTransaction } from "@/lib/solana/checked-transfers";
import { solanaRpc } from "@/lib/solana/rpc";
import type { WalletPosition } from "@/lib/types";
import { decodeFinalizedPumpTransaction } from "@/lib/indexer/pumpfun-decoder";
import { observePumpPrice } from "@/lib/solana/pumpfun";
import { applyPositionEvent, emptyPosition, type PositionEvent } from "@/lib/rewards/position";
import { calculateLossWeightedRewards } from "@/lib/rewards/calculator";
import type { RewardSnapshotPosition } from "@/lib/types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface MarketRow {
  venue?: string;
  launch_id: string; base_mint: string; quote_mint: string; market_address: string; base_decimals: number; quote_decimals: number;
  launch_slot: number | string; last_indexed_slot: number | string; creator_address: string; authority_address: string; config_address: string;
  platform_config_address: string; base_vault: string; quote_vault: string; history_complete: boolean; price_status: string;
  last_indexed_blockhash?: string | null; base_token_program: string; quote_token_program: string;
  launch_signature?: string | null;
}
async function claim(db: SupabaseClient, type: string, id: string, owner: string) {
  const { data, error } = await db.rpc("claim_worker_lease", { p_resource_type: type, p_resource_id: id, p_owner_id: owner, p_seconds: 90 });
  if (error) throw error;
  return Boolean(data);
}

export async function reconcileMarket(db: SupabaseClient, row: MarketRow, owner: string) {
  if (!await claim(db, "market", row.launch_id, owner)) return;
  // Price observations do not certify history completeness. Keep the public
  // price available while historical blocks catch up; epoch planning remains gated.
  await recordMarketPrice(db, row);
  const finalizedSlot = await solanaRpc<number>("getSlot", [{ commitment: "finalized" }]);
  let cursor = Math.max(Number(row.last_indexed_slot ?? 0), Number(row.launch_slot) - 1);
  const end = Math.min(finalizedSlot, cursor + Math.max(10, Number(process.env.INDEX_BLOCK_BATCH_SIZE ?? 100)));
  let blockhash = row.last_indexed_blockhash ?? null;
  const startedAt = Date.now();
  let leaseRenewedAt = startedAt;
  if (end > cursor) {
    const produced = await solanaRpc<number[]>("getBlocks", [cursor + 1, end, { commitment: "finalized" }]);
    // Fetch a small bounded window in parallel, but apply/checkpoint strictly in
    // chain order. Slow HTTP reads must not make backfill slower than the chain.
    const requestedWidth = Number(process.env.INDEX_BLOCK_FETCH_CONCURRENCY ?? 12);
    const width = Number.isInteger(requestedWidth) && requestedWidth > 0 ? Math.min(24, requestedWidth) : 12;
    scan: for (let offset = 0; offset < produced.length; offset += width) {
      const slots = produced.slice(offset, offset + width);
      const blocks = await Promise.allSettled(slots.map(slot => solanaRpc<{ blockhash: string; previousBlockhash: string; blockTime: number | null; transactions: FinalizedBlockTransaction[] } | null>("getBlock", [slot, { commitment: "finalized", encoding: "jsonParsed", transactionDetails: "full", rewards: false, maxSupportedTransactionVersion: 1 }])));
      for (const [index, slot] of slots.entries()) {
      // RPC parses legacy/v0/v1 into the same instruction/account JSON. No
      // legacy SDK wire decoder is used here and v1 compute-fee headers are not basis.
      const result = blocks[index];
      if (result.status === "rejected") throw result.reason;
      const block = result.value;
      if (!block) throw new Error(`Finalized block ${slot} is unavailable`);
      if (Date.now() - leaseRenewedAt >= 20_000) {
        if (!await claim(db, "market", row.launch_id, owner)) throw new Error("Market lease lost; stopping reconciliation");
        leaseRenewedAt = Date.now();
      }
      if (blockhash && block.previousBlockhash !== blockhash) throw new Error(`Finalized chain continuity failed at slot ${slot}`);
      for (const [transactionIndex, transaction] of block.transactions.entries()) {
        if (transaction.transaction.signatures[0] === row.launch_signature) continue;
        const decoded = (row.venue === "pumpfun" ? decodeFinalizedPumpTransaction : decodeFinalizedLaunchLabTransaction)(transaction, {
          launchId: row.launch_id, marketAddress: row.market_address, baseMint: row.base_mint, quoteMint: row.quote_mint,
          authorityAddress: row.authority_address, configAddress: row.config_address, platformConfigAddress: row.platform_config_address,
          baseVault: row.base_vault, quoteVault: row.quote_vault, baseTokenProgram: row.base_token_program,
          quoteTokenProgram: row.quote_token_program, creatorAddress: row.creator_address,
        }, BigInt(slot));
        for (let index = 0; index < decoded.events.length; index += 1) {
          const event = decoded.events[index];
          const { error } = await db.rpc("apply_wallet_activity", {
            p_launch_id: row.launch_id, p_wallet: event.wallet, p_signature: decoded.signature, p_event_index: activityOrdinal(transactionIndex, index),
            p_kind: event.kind, p_token_raw: event.tokenRaw.toString(), p_quote_atoms: event.kind === "verified_buy" ? event.quoteAtoms.toString() : null, p_slot: slot,
          });
          if (error) throw error;
        }
      }
      blockhash = block.blockhash;
      cursor = slot;
      const checkpoint = await db.from("tracked_markets").update({ last_indexed_slot: cursor, last_indexed_blockhash: blockhash, history_complete: false }).eq("launch_id", row.launch_id);
      if (checkpoint.error) throw checkpoint.error;
      if (Date.now() - startedAt > 45_000) break scan;
      }
    }
    // Only skip unproduced slots after every produced block was processed.
    if (!produced.length || cursor === produced.at(-1)) cursor = end;
    await db.from("chain_event_inbox").update({ status: "confirmed", processed_at: new Date().toISOString(), last_error: null }).eq("launch_id", row.launch_id).lte("observed_slot", cursor).in("status", ["pending", "processing", "failed"]);
  }
  const checkpoint = await db.from("tracked_markets").update({
    last_indexed_slot: cursor, last_indexed_blockhash: blockhash, history_complete: cursor >= finalizedSlot, price_status: "fresh",
    last_reconciled_at: new Date().toISOString(), updated_at: new Date().toISOString(), tracker_error: null,
  }).eq("launch_id", row.launch_id);
  if (checkpoint.error) throw checkpoint.error;
  return cursor >= finalizedSlot;
}

async function recordMarketPrice(db: SupabaseClient, row: MarketRow) {
  const observation = await (row.venue === "pumpfun" ? observePumpPrice : observeLaunchLabPrice)({
    launchId: row.launch_id, marketAddress: row.market_address, baseMint: row.base_mint, quoteMint: row.quote_mint,
    creatorAddress: row.creator_address, configAddress: row.config_address, platformConfigAddress: row.platform_config_address,
    baseVault: row.base_vault, quoteVault: row.quote_vault, tokenDecimals: row.base_decimals,
    baseTokenProgram: row.base_token_program, quoteTokenProgram: row.quote_token_program,
  });
  const { error } = await db.from("price_observations").upsert({
    launch_id: row.launch_id, market_address: row.market_address, slot: observation.slot, block_time: observation.blockTime,
    price_quote_atoms_per_token: observation.priceQuoteAtomsPerToken.toString(), source: row.venue === "pumpfun" ? "pump_curve" : "launchlab_pool",
    payload_hash: hash({ slot: observation.slot, price: observation.priceQuoteAtomsPerToken.toString() }),
  }, { onConflict: "launch_id,slot,source", ignoreDuplicates: true });
  if (error) throw error;
}

export function activityOrdinal(transactionIndex: number, eventIndex: number) {
  if (!Number.isInteger(transactionIndex) || transactionIndex < 0 || transactionIndex >= 32768 || !Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= 65536) throw new Error("Block activity order exceeds supported integer range");
  return transactionIndex * 65536 + eventIndex;
}

async function positionsAtSnapshot(db: SupabaseClient, launchId: string, snapshotSlot: string | number) {
  const positions = new Map<string, WalletPosition>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("wallet_activity").select("wallet,kind,token_raw,quote_atoms,slot")
      .eq("launch_id", launchId).lte("slot", snapshotSlot).order("slot").order("event_index").order("signature").order("wallet").range(offset, offset + 999);
    if (error) throw error;
    for (const item of data ?? []) {
      const event = { launchId, wallet: item.wallet, kind: item.kind, tokenRaw: BigInt(item.token_raw), slot: BigInt(item.slot), ...(item.kind === "verified_buy" ? { quoteAtoms: BigInt(item.quote_atoms) } : {}) } as PositionEvent;
      positions.set(item.wallet, applyPositionEvent(positions.get(item.wallet) ?? emptyPosition(launchId, item.wallet), event));
    }
    if (!data || data.length < 1000) break;
  }
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("reward_distributions").select("wallet,amount_atoms,reward_epochs!reward_distributions_epoch_id_fkey!inner(snapshot_slot)")
      .eq("launch_id", launchId).eq("status", "confirmed").lt("reward_epochs.snapshot_slot", snapshotSlot).order("id").range(offset, offset + 999);
    if (error) throw error;
    for (const item of data ?? []) { const position = positions.get(item.wallet); if (position) position.previousRewardsQuoteAtoms += BigInt(item.amount_atoms); }
    if (!data || data.length < 1000) break;
  }
  return [...positions.values()];
}

export async function planEpoch(db: SupabaseClient, row: MarketRow, owner: string) {
  if (!row.history_complete || row.price_status !== "fresh" || !await claim(db, "epoch", row.launch_id, owner)) return;
  const { data: launch, error: launchError } = await db.from("launches").select("status").eq("id", row.launch_id).single();
  if (launchError) throw launchError;
  if (launch.status !== "active") return;
  const { data: active } = await db.from("reward_epochs").select("*").eq("launch_id", row.launch_id).in("status", ["pending", "running"]).maybeSingle();
  let epoch = active;
  if (!epoch) {
    const { data: previous } = await db.from("reward_epochs").select("snapshot_slot,end_time").eq("launch_id", row.launch_id).eq("status", "completed").order("sequence", { ascending: false }).limit(1).maybeSingle();
    const interval = Number(process.env.REWARD_EPOCH_SECONDS ?? 3600);
    const { data: earliest, error: earliestError } = await db.from("price_observations").select("block_time").eq("launch_id", row.launch_id).order("block_time").limit(1).maybeSingle();
    if (earliestError) throw earliestError;
    if (!earliest) return;
    const startTime = new Date(previous?.end_time ?? earliest.block_time);
    if (Date.now() - startTime.getTime() < interval * 1000) return;
    const { data: observations, error: priceError } = await db.from("price_observations").select("slot,block_time,price_quote_atoms_per_token").eq("launch_id", row.launch_id).gte("block_time", startTime.toISOString()).lte("slot", row.last_indexed_slot).order("block_time");
    if (priceError) throw priceError;
    const endTime = new Date();
    const canonical = canonicalEpochPrice({
      observations: (observations ?? []).map((item) => ({ slot: Number(item.slot), blockTime: item.block_time, priceQuoteAtomsPerToken: BigInt(item.price_quote_atoms_per_token) })),
      startTime, endTime, maxGapSeconds: Number(process.env.MAX_PRICE_GAP_SECONDS ?? 180),
    });
    if (Date.now() - new Date(observations!.at(-1)!.block_time).getTime() > Number(process.env.MAX_PRICE_AGE_SECONDS ?? 180) * 1000) throw new Error("Price is stale; epoch not payable");
    if (canonical.endSlot > Number(row.last_indexed_slot)) return;
    const { data: id, error } = await db.rpc("reserve_epoch_budget", {
      p_launch_id: row.launch_id, p_start_slot: previous?.snapshot_slot ? Number(previous.snapshot_slot) + 1 : canonical.startSlot,
      p_snapshot_slot: canonical.endSlot, p_start_time: startTime.toISOString(),
      p_end_time: endTime.toISOString(), p_price: canonical.priceQuoteAtomsPerToken.toString(),
    });
    if (error) throw error;
    if (!id) return;
    const result = await db.from("reward_epochs").select("*").eq("id", id).single();
    if (result.error) throw result.error;
    epoch = result.data;
  }
  if (Number(epoch.snapshot_slot) > Number(row.last_indexed_slot)) return;
  const positions = await positionsAtSnapshot(db, row.launch_id, epoch.snapshot_slot);
  const { data: market, error: marketError } = await db.from("tracked_markets").select("base_decimals").eq("launch_id", row.launch_id).single();
  if (marketError) throw marketError;
  let plan = buildEpochPlan({
    launchId: row.launch_id, epochId: epoch.id, startSlot: BigInt(epoch.start_slot), snapshotSlot: BigInt(epoch.snapshot_slot),
    fundedBudgetQuoteAtoms: BigInt(epoch.funded_budget_atoms), currentPriceQuoteAtomsPerToken: BigInt(epoch.reference_price_quote_atoms),
    tokenDecimals: market.base_decimals, positions,
  });
  // A retry must use the published snapshot, including after partial payouts.
  const savedSnapshots: RewardSnapshotPosition[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("reward_snapshots").select("*").eq("launch_id", row.launch_id).eq("epoch_id", epoch.id).order("wallet").range(offset, offset + 999);
    if (error) throw error;
    for (const item of data ?? []) savedSnapshots.push({ launchId: row.launch_id, wallet: item.wallet, status: item.status, averageEntryQuoteAtoms: BigInt(item.average_entry_quote_atoms), currentValueQuoteAtoms: BigInt(item.current_value_quote_atoms), eligibleUnitsRaw: BigInt(item.eligible_units_raw), eligibleLossQuoteAtoms: BigInt(item.eligible_loss_quote_atoms), previousRewardsQuoteAtoms: BigInt(item.previous_rewards_quote_atoms) });
    if (!data || data.length < 1000) break;
  }
  if (savedSnapshots.length) {
    const allocations = calculateLossWeightedRewards({ launchId: row.launch_id, epochId: epoch.id, fundedBudgetQuoteAtoms: BigInt(epoch.funded_budget_atoms), snapshots: savedSnapshots });
    plan = { ...plan, snapshots: savedSnapshots, allocations, distributedQuoteAtoms: allocations.reduce((sum, item) => sum + item.amountQuoteAtoms, 0n) };
  }
  const allocationHash = hash(plan.allocations.map((item) => [item.wallet, item.amountQuoteAtoms.toString()]));
  const { count: snapshotCount } = await db.from("reward_snapshots").select("id", { count: "exact", head: true }).eq("epoch_id", epoch.id);
  if (!snapshotCount && plan.snapshots.length) {
    const { error } = await db.from("reward_snapshots").insert(plan.snapshots.map((item) => ({
      launch_id: row.launch_id, epoch_id: epoch.id, wallet: item.wallet, status: item.status,
      average_entry_quote_atoms: item.averageEntryQuoteAtoms.toString(), current_value_quote_atoms: item.currentValueQuoteAtoms.toString(),
      eligible_units_raw: item.eligibleUnitsRaw.toString(), eligible_loss_quote_atoms: item.eligibleLossQuoteAtoms.toString(),
      previous_rewards_quote_atoms: item.previousRewardsQuoteAtoms.toString(),
    })));
    if (error) throw error;
  }
  const { count: allocationCount } = await db.from("reward_allocations").select("id", { count: "exact", head: true }).eq("epoch_id", epoch.id);
  if (!allocationCount && plan.allocations.length) {
    const { error } = await db.from("reward_allocations").insert(plan.allocations.map((item) => ({
      launch_id: row.launch_id, epoch_id: epoch.id, wallet: item.wallet, amount_atoms: item.amountQuoteAtoms.toString(), eligible_loss_quote_atoms: item.eligibleLossQuoteAtoms.toString(),
    })));
    if (error) throw error;
  }
  if (plan.allocations.length) {
    const batchSize = Math.max(1, Math.min(8, Number(process.env.PAYOUT_BATCH_SIZE ?? 4)));
    for (let offset = 0, sequence = 0; offset < plan.allocations.length; offset += batchSize, sequence += 1) {
      const group = plan.allocations.slice(offset, offset + batchSize);
      const manifest = group.map((item) => ({ wallet: item.wallet, amountAtoms: item.amountQuoteAtoms.toString() }));
      const amount = group.reduce((sum, item) => sum + item.amountQuoteAtoms, 0n);
      const { data: batch, error: batchError } = await db.from("payout_batches").upsert({
        launch_id: row.launch_id, epoch_id: epoch.id, sequence, asset_mint: epoch.reward_asset_mint,
        amount_atoms: amount.toString(), status: "planned", manifest, manifest_hash: hash(manifest),
      }, { onConflict: "launch_id,epoch_id,sequence", ignoreDuplicates: true }).select("id").maybeSingle();
      if (batchError) throw batchError;
      const batchId = batch?.id ?? (await db.from("payout_batches").select("id").eq("launch_id", row.launch_id).eq("epoch_id", epoch.id).eq("sequence", sequence).single()).data?.id;
      if (!batchId) throw new Error("Payout batch recovery failed");
      const { error: distributionError } = await db.from("reward_distributions").upsert(group.map((item) => ({
        launch_id: row.launch_id, epoch_id: epoch.id, payout_batch_id: batchId, wallet: item.wallet,
        asset_mint: epoch.reward_asset_mint, amount_atoms: item.amountQuoteAtoms.toString(), status: "pending",
        idempotency_key: `reward:${row.launch_id}:${epoch.id}:${item.wallet}`,
      })), { onConflict: "launch_id,epoch_id,wallet", ignoreDuplicates: true });
      if (distributionError) throw distributionError;
    }
  }
  await db.from("reward_epochs").update({ allocation_hash: allocationHash }).eq("id", epoch.id).eq("status", "running");
  if (!plan.allocations.length) {
    const { error } = await db.rpc("release_empty_epoch", { p_epoch_id: epoch.id });
    if (error) throw error;
  }
}

export async function reconcilePayoutBatches(db: SupabaseClient) {
  const { data, error } = await db.from("payout_batches").select("*").in("status", ["signed", "submitted", "uncertain"]);
  if (error) throw error;
  for (const batch of data ?? []) {
    if (!batch.signature || !batch.signed_transaction) continue;
    try {
      const proof = await verifyFinalizedSignedTransaction(batch.signature, batch.signed_transaction);
      if (!proof) continue;
      const { error: rpcError } = await db.rpc("confirm_payout_batch", { p_batch_id: batch.id, p_slot: proof.slot, p_proof: proof });
      if (rpcError) throw rpcError;
    } catch (caught) {
      await db.from("payout_batches").update({ status: "uncertain", error_message: caught instanceof Error ? caught.message : "Payout reconciliation failed" }).eq("id", batch.id).neq("status", "confirmed");
    }
  }
}
