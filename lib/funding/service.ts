import { randomUUID } from "node:crypto";
import { getAdminDb } from "@/lib/db/server";
import { splitFundedFees } from "@/lib/rewards/calculator";
import {
  broadcastSignedCheckedTransfer,
  inspectSignedCheckedTransfer,
  prepareCheckedTransfer,
  verifyFinalizedSignedTransaction,
} from "@/lib/solana/checked-transfers";
import { solanaRpc } from "@/lib/solana/rpc";

export function decimalToAtoms(value: string, decimals: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Amount must be a positive decimal number");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const atoms = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (atoms <= 0n) throw new Error("Amount must be positive");
  return atoms;
}

export async function prepareLaunchFunding(launchId: string, funderWallet: string, amount: string) {
  if (process.env.DRY_RUN !== "false") throw new Error("Funding is locked while DRY_RUN is enabled. No wallet signature or deposit is required yet.");
  const db = getAdminDb();
  const { data: launch, error } = await db.from("launches")
    .select("id,status,venue,creator_wallet,quote_mint,launch_configs(*)")
    .eq("id", launchId).single();
  if (error) throw error;
  if (!launch || !["active", "paused"].includes(launch.status)) throw new Error("Launch is not available for funding");
  if (launch.creator_wallet !== funderWallet) throw new Error("Connect the launch creator wallet to attribute creator-fee funding");
  const config = Array.isArray(launch.launch_configs) ? launch.launch_configs[0] : launch.launch_configs;
  if (!config?.treasury_address) throw new Error("This launch has no configured reward treasury");
  if (config.treasury_address === funderWallet) throw new Error("Use a separate creator funding wallet. A treasury self-transfer cannot fund rewards.");

  const mintProbe = await prepareCheckedTransfer({
    payer: funderWallet,
    mint: launch.quote_mint,
    transfers: [{ recipient: config.treasury_address, amountAtoms: 1n }],
    memo: `TOPBLAST:PROBE:${randomUUID()}`,
    wrapNative: launch.venue === "pumpfun",
  });
  const gross = decimalToAtoms(amount, mintProbe.decimals);
  const split = splitFundedFees(launchId, launchId, gross, {
    topblastPercent: config.topblast_percent,
    creatorPercent: config.creator_percent,
    protocolPercent: config.protocol_percent,
  });
  if (split.topblast <= 0n) throw new Error("TopBlast reward allocation rounds to zero");
  const protocolTreasury = process.env.PROTOCOL_TREASURY_ADDRESS;
  if (split.protocol > 0n && !protocolTreasury) throw new Error("PROTOCOL_TREASURY_ADDRESS is required for this launch allocation");
  const intentId = randomUUID();
  const memo = `TOPBLAST:FUND:${intentId}`;
  const transfers = [{ recipient: config.treasury_address, amountAtoms: split.topblast }];
  if (split.protocol > 0n) transfers.push({ recipient: protocolTreasury!, amountAtoms: split.protocol });
  const prepared = await prepareCheckedTransfer({ payer: funderWallet, mint: launch.quote_mint, transfers, memo, wrapNative: launch.venue === "pumpfun" });
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  const { error: insertError } = await db.from("funding_intents").insert({
    id: intentId, launch_id: launchId, funder_wallet: funderWallet, asset_mint: launch.quote_mint,
    gross_amount_atoms: gross.toString(), reward_amount_atoms: split.topblast.toString(),
    creator_amount_atoms: split.creator.toString(), protocol_amount_atoms: split.protocol.toString(),
    reward_treasury: config.treasury_address, protocol_treasury: protocolTreasury ?? null,
    memo, unsigned_transaction: prepared.unsignedTransaction, unsigned_message_hash: prepared.messageHash,
    last_valid_block_height: prepared.lastValidBlockHeight, expires_at: expiresAt,
  });
  if (insertError) throw insertError;
  return {
    intentId, launchId, unsignedTransaction: prepared.unsignedTransaction, messageHash: prepared.messageHash,
    expiresAt, decimals: prepared.decimals, assetMint: launch.quote_mint,
    grossAmountAtoms: gross.toString(), rewardAmountAtoms: split.topblast.toString(),
    creatorAmountAtoms: split.creator.toString(), protocolAmountAtoms: split.protocol.toString(),
    rewardTreasury: config.treasury_address, protocolTreasury: protocolTreasury ?? null, memo,
    rewardSymbol: launch.venue === "pumpfun" ? "WSOL" : "STONK", wrapsNativeSol: launch.venue === "pumpfun",
  };
}

export async function submitLaunchFunding(intentId: string, signedTransaction: string) {
  if (process.env.DRY_RUN !== "false") throw new Error("Live funding submission is locked while DRY_RUN is enabled");
  const db = getAdminDb();
  const { data: intent, error } = await db.from("funding_intents").select("*").eq("id", intentId).single();
  if (error) throw error;
  if (intent.status === "confirmed") return reconcileLaunchFunding(intentId);
  if (!["prepared", "submitted", "uncertain"].includes(intent.status)) throw new Error(`Funding intent is ${intent.status}`);
  const inspected = inspectSignedCheckedTransfer({ signedTransaction, expectedMessageHash: intent.unsigned_message_hash, expectedPayer: intent.funder_wallet });
  if (intent.signature && intent.signature !== inspected.signature) throw new Error("A different transaction is already bound to this funding intent");
  const { data: bound, error: bindError } = await db.from("funding_intents").update({
    signature: inspected.signature, signed_transaction: signedTransaction, status: "submitted", updated_at: new Date().toISOString(),
  }).eq("id", intentId).in("status", ["prepared", "submitted", "uncertain"]).or(`signature.is.null,signature.eq.${inspected.signature}`).select("id").maybeSingle();
  if (bindError) throw bindError;
  if (!bound && !intent.signature) throw new Error("Funding intent was already claimed");
  try {
    await broadcastSignedCheckedTransfer(signedTransaction);
  } catch (caught) {
    await db.from("funding_intents").update({ status: "uncertain", error_message: caught instanceof Error ? caught.message : "Broadcast result uncertain", updated_at: new Date().toISOString() }).eq("id", intentId).neq("status", "confirmed");
  }
  return reconcileLaunchFunding(intentId);
}

export async function reconcileLaunchFunding(intentId: string) {
  const db = getAdminDb();
  const { data: intent, error } = await db.from("funding_intents").select("*").eq("id", intentId).single();
  if (error) throw error;
  if (intent.status === "confirmed") return { status: "confirmed", signature: intent.signature, launchId: intent.launch_id };
  if (!intent.signature || !intent.signed_transaction) return { status: intent.status, signature: intent.signature, launchId: intent.launch_id };
  const finality = await verifyFinalizedSignedTransaction(intent.signature, intent.signed_transaction);
  if (!finality) {
    const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
    if (height > Number(intent.last_valid_block_height)) {
      const message = "Expired blockhash; archival reconciliation required before another funding transfer";
      await db.from("funding_intents").update({ status: "uncertain", error_message: message, updated_at: new Date().toISOString() }).eq("id", intentId).in("status", ["submitted", "uncertain"]);
      return { status: "uncertain_expired", signature: intent.signature, launchId: intent.launch_id };
    }
    return { status: "submitted", signature: intent.signature, launchId: intent.launch_id };
  }
  const proof = {
    version: 1, ...finality, memo: intent.memo, sender: intent.funder_wallet, assetMint: intent.asset_mint,
    grossAmountAtoms: String(intent.gross_amount_atoms), rewardAmountAtoms: String(intent.reward_amount_atoms),
    creatorRetainedAtoms: String(intent.creator_amount_atoms), protocolAmountAtoms: String(intent.protocol_amount_atoms),
    rewardTreasury: intent.reward_treasury, protocolTreasury: intent.protocol_treasury,
  };
  if (finality.blockTime == null) return { status: "submitted", signature: intent.signature, launchId: intent.launch_id, message: "Finalized block time is unavailable. Keep this receipt and retry verification." };
  const blockTime = new Date(finality.blockTime * 1000).toISOString();
  const { error: rpcError } = await db.rpc("confirm_funding_deposit", {
    p_intent_id: intentId, p_signature: intent.signature, p_slot: finality.slot, p_block_time: blockTime, p_proof: proof,
  });
  if (rpcError) throw rpcError;
  const { data: event, error: feeError } = await db.from("fee_events").upsert({
    launch_id: intent.launch_id, asset_mint: intent.asset_mint, amount_atoms: String(intent.gross_amount_atoms),
    source: "creator_deposit", signature: intent.signature, venue_intent_id: intentId, status: "confirmed",
  }, { onConflict: "launch_id,signature,asset_mint" }).select("id").single();
  if (feeError) throw feeError;
  await db.from("fee_allocations").upsert({
    launch_id: intent.launch_id, fee_event_id: event.id, topblast_atoms: String(intent.reward_amount_atoms),
    creator_atoms: String(intent.creator_amount_atoms), protocol_atoms: String(intent.protocol_amount_atoms),
  }, { onConflict: "launch_id,fee_event_id" });
  return { status: "confirmed", signature: intent.signature, launchId: intent.launch_id, proof };
}
