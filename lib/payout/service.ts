import { getAdminDb } from "@/lib/db/server";
import {
  broadcastSignedCheckedTransfer,
  inspectSignedCheckedTransfer,
  prepareCheckedTransfer,
  verifyFinalizedSignedTransaction,
} from "@/lib/solana/checked-transfers";
import { solanaRpc } from "@/lib/solana/rpc";
import { NATIVE_MINT } from "@solana/spl-token";
import { getLaunchWallet } from "@/lib/payout/launch-wallet";

export async function preparePayoutBatch(batchId: string) {
  const db = getAdminDb();
  const { data: batch, error } = await db.from("payout_batches").select("*").eq("id", batchId).single();
  if (error) throw error;
  const { data: launch, error: launchError } = await db.from("launches").select("status,venue").eq("id", batch.launch_id).single();
  if (launchError) throw launchError;
  if (launch.status !== "active") throw new Error("This launch is paused; payout preparation is locked");
  if (batch.status === "prepared") return batch;
  if (batch.status !== "planned") throw new Error(`Payout batch is ${batch.status}`);
  const wallet = await getLaunchWallet(db, batch.launch_id);
  const treasury = wallet.address;
  if (wallet.binding.rewardMint !== batch.asset_mint) throw new Error("Payout asset does not match this launch's funded reward asset");
  const manifest = batch.manifest as Array<{ wallet: string; amountAtoms: string }>;
  if (!Array.isArray(manifest) || !manifest.length) throw new Error("Payout manifest is empty");
  const total = manifest.reduce((sum, item) => sum + BigInt(item.amountAtoms), 0n);
  if (total !== BigInt(batch.amount_atoms)) throw new Error("Payout manifest does not match reserved batch amount");
  const prepared = await prepareCheckedTransfer({
    payer: treasury, mint: batch.asset_mint,
    transfers: manifest.map((item) => ({ recipient: item.wallet, amountAtoms: BigInt(item.amountAtoms) })),
    memo: `TOPBLAST:PAYOUT:${batch.launch_id}:${batch.epoch_id}:${batch.id}`,
    wrapNative: launch.venue === "pumpfun" && batch.asset_mint === NATIVE_MINT.toBase58(),
  });
  const { data, error: updateError } = await db.from("payout_batches").update({
    status: "prepared", unsigned_transaction: prepared.unsignedTransaction, unsigned_message_hash: prepared.messageHash,
    last_valid_block_height: prepared.lastValidBlockHeight, prepared_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", batchId).eq("status", "planned").select("*").single();
  if (updateError) throw updateError;
  return data;
}

export async function submitPayoutBatch(batchId: string, signedTransaction: string) {
  if (process.env.DRY_RUN !== "false") throw new Error("Live payout submission is locked while DRY_RUN is enabled");
  const db = getAdminDb();
  const { data: pause } = await db.from("system_config").select("value").eq("key", "reward_engine_paused").maybeSingle();
  if (pause?.value !== false) throw new Error("Reward engine is paused; payout signing is locked");
  const { data: batch, error } = await db.from("payout_batches").select("*").eq("id", batchId).single();
  if (error) throw error;
  if (batch.status === "confirmed") return reconcilePayoutBatch(batchId);
  const { data: launch, error: launchError } = await db.from("launches").select("status").eq("id", batch.launch_id).single();
  if (launchError) throw launchError;
  if (launch.status !== "active") throw new Error("This launch is paused; payout submission is locked");
  if (batch.status !== "prepared" && !["submitted", "uncertain"].includes(batch.status)) throw new Error(`Payout batch is ${batch.status}`);
  const wallet = await getLaunchWallet(db, batch.launch_id);
  const treasury = wallet.address;
  if (wallet.binding.rewardMint !== batch.asset_mint) throw new Error("Payout asset does not match this launch's funded reward asset");
  const inspected = inspectSignedCheckedTransfer({ signedTransaction, expectedMessageHash: batch.unsigned_message_hash, expectedPayer: treasury });
  if (batch.signature && batch.signature !== inspected.signature) throw new Error("A different transaction is already bound to this payout batch");
  const { error: submitError } = await db.rpc("submit_payout_batch", { p_batch_id: batchId, p_signature: inspected.signature, p_signed_transaction: signedTransaction });
  if (submitError) throw submitError;
  try { await broadcastSignedCheckedTransfer(signedTransaction); }
  catch (caught) {
    await db.from("payout_batches").update({ status: "uncertain", error_message: caught instanceof Error ? caught.message : "Broadcast result uncertain" }).eq("id", batchId).neq("status", "confirmed");
  }
  return reconcilePayoutBatch(batchId);
}

export async function reconcilePayoutBatch(batchId: string) {
  const db = getAdminDb();
  const { data: batch, error } = await db.from("payout_batches").select("*").eq("id", batchId).single();
  if (error) throw error;
  if (batch.status === "confirmed") return { status: "confirmed", signature: batch.signature, batchId };
  if (!batch.signature || !batch.signed_transaction) return { status: batch.status, signature: batch.signature, batchId };
  const finality = await verifyFinalizedSignedTransaction(batch.signature, batch.signed_transaction);
  if (!finality) {
    const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
    if (!Number.isSafeInteger(height) || !Number.isSafeInteger(Number(batch.last_valid_block_height)) || Number(batch.last_valid_block_height) <= 0) throw new Error("Payout blockheight validity is unavailable");
    if (batch.last_valid_block_height && height > Number(batch.last_valid_block_height)) {
      // Never rebuild an expired transaction from a single missing RPC result.
      // A validator may have accepted it while the queried RPC is delayed or
      // missing archival history. Keep the exact signed bytes bound until a
      // later reconciliation proves the original transaction's outcome.
      const message = "Expired blockhash; archival reconciliation required before any replacement";
      await db.from("payout_batches").update({ status: "uncertain", error_message: message, updated_at: new Date().toISOString() }).eq("id", batchId).neq("status", "confirmed");
      return { status: "uncertain_expired", signature: batch.signature, batchId };
    }
    // A worker can stop after persisting the signed receipt and before the
    // initial broadcast. Resume those exact bytes while their blockhash is valid.
    // Rebroadcasting the same signature is idempotent, not a second payment.
    await broadcastSignedCheckedTransfer(batch.signed_transaction).catch(() => undefined);
    return { status: "submitted", signature: batch.signature, batchId };
  }
  const { error: rpcError } = await db.rpc("confirm_payout_batch", { p_batch_id: batchId, p_slot: finality.slot, p_proof: { version: 1, ...finality, manifestHash: batch.manifest_hash } });
  if (rpcError) throw rpcError;
  return { status: "confirmed", signature: batch.signature, batchId, proof: finality };
}
