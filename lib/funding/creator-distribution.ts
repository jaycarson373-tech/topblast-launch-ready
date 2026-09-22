import type { SupabaseClient } from "@supabase/supabase-js";
import { broadcastSignedCheckedTransfer, inspectSignedCheckedTransfer, prepareCheckedTransfer, verifyFinalizedSignedTransaction } from "@/lib/solana/checked-transfers";
import { createRailwaySigner } from "@/lib/payout/railway-signer";
import { solanaRpc } from "@/lib/solana/rpc";

export type CreatorDistributionResult = { status: "disabled" | "lease_busy" | "idle" | "awaiting_finality" | "submitted" | "confirmed"; id?: string; signature?: string | null };

function enabled(env: NodeJS.ProcessEnv) { return env.PAYOUT_MODE === "server_signer" && env.DRY_RUN === "false"; }

async function reconcile(db: SupabaseClient, row: Record<string, unknown>) {
  const id = String(row.id), signature = row.signature ? String(row.signature) : null, signed = row.signed_transaction ? String(row.signed_transaction) : null;
  if (!signature || !signed) return { status: String(row.status), signature };
  const proof = await verifyFinalizedSignedTransaction(signature, signed);
  if (proof) {
    const updated = await db.from("creator_fee_distributions").update({ status: "confirmed", proof, updated_at: new Date().toISOString(), error_message: null }).eq("id", id).neq("status", "confirmed");
    if (updated.error) throw updated.error;
    return { status: "confirmed", signature };
  }
  const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
  if (height > Number(row.last_valid_block_height)) {
    const updated = await db.from("creator_fee_distributions").update({ status: "uncertain", error_message: "Signed creator distribution expired without finalized proof; archival reconciliation required", updated_at: new Date().toISOString() }).eq("id", id).neq("status", "confirmed");
    if (updated.error) throw updated.error;
    return { status: "uncertain", signature };
  }
  await broadcastSignedCheckedTransfer(signed).catch(() => undefined);
  await db.from("creator_fee_distributions").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("id", id).neq("status", "confirmed");
  return { status: "submitted", signature };
}

export async function processCreatorFeeDistribution(db: SupabaseClient, owner: string, env: NodeJS.ProcessEnv = process.env): Promise<CreatorDistributionResult> {
  if (!enabled(env)) return { status: "disabled" };
  const treasury = env.TOPBLAST_TREASURY_ADDRESS;
  if (!treasury) throw new Error("TOPBLAST_TREASURY_ADDRESS is required for creator distributions");
  const signer = createRailwaySigner(env as Record<string, string | undefined>);
  if (signer.publicKey() !== treasury) throw new Error("TREASURY_PRIVATE_KEY does not match TOPBLAST_TREASURY_ADDRESS");
  const limitText = env.TOPBLAST_MAX_PAYOUT_ATOMS;
  if (!limitText || !/^\d+$/.test(limitText) || BigInt(limitText) <= 0n) throw new Error("TOPBLAST_MAX_PAYOUT_ATOMS must be a positive integer");
  const lease = await db.rpc("claim_worker_lease", { p_resource_type: "payout_treasury", p_resource_id: treasury, p_owner_id: owner, p_seconds: 60 });
  if (lease.error) throw lease.error;
  if (lease.data !== true) return { status: "lease_busy" };

  const active = await db.from("creator_fee_distributions").select("*").in("status", ["signed", "submitted", "uncertain"]).order("created_at").limit(1).maybeSingle();
  if (active.error) throw active.error;
  if (active.data) {
    const result = await reconcile(db, active.data);
    return { status: result.status === "confirmed" ? "confirmed" : "awaiting_finality", id: active.data.id, signature: result.signature };
  }

  const next = await db.from("creator_fee_distributions").select("*").in("status", ["planned", "prepared"]).order("created_at").limit(1).maybeSingle();
  if (next.error) throw next.error;
  if (!next.data) return { status: "idle" };
  const row = next.data;
  if (BigInt(row.amount_atoms) > BigInt(limitText)) throw new Error(`Creator distribution ${row.id} exceeds TOPBLAST_MAX_PAYOUT_ATOMS`);
  if (row.status === "planned") {
    const prepared = await prepareCheckedTransfer({
      payer: treasury, mint: row.asset_mint,
      transfers: [{ recipient: row.wallet, amountAtoms: BigInt(row.amount_atoms) }],
      memo: `TOPBLAST:CREATOR:${row.launch_id}:${row.fee_event_id}`,
    });
    const updated = await db.from("creator_fee_distributions").update({
      status: "prepared", unsigned_transaction: prepared.unsignedTransaction, unsigned_message_hash: prepared.messageHash,
      last_valid_block_height: prepared.lastValidBlockHeight, updated_at: new Date().toISOString(), error_message: null,
    }).eq("id", row.id).eq("status", "planned").select("*").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return { status: "lease_busy" };
    Object.assign(row, updated.data);
  }
  if (!row.unsigned_transaction || !row.unsigned_message_hash) throw new Error("Prepared creator distribution is missing exact transaction bytes");
  const signed = signer.signTransaction({ transactionBase64: row.unsigned_transaction, expectedMessageHash: row.unsigned_message_hash, expectedPayer: treasury });
  const inspected = inspectSignedCheckedTransfer({ signedTransaction: signed, expectedMessageHash: row.unsigned_message_hash, expectedPayer: treasury });
  const persisted = await db.from("creator_fee_distributions").update({
    status: "signed", signed_transaction: signed, signature: inspected.signature, updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("status", "prepared").select("*").maybeSingle();
  if (persisted.error) throw persisted.error;
  if (!persisted.data) return { status: "lease_busy" };
  await broadcastSignedCheckedTransfer(signed).catch(() => undefined);
  await db.from("creator_fee_distributions").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "signed");
  const final = await reconcile(db, { ...persisted.data, status: "submitted" });
  return { status: final.status === "confirmed" ? "confirmed" : "submitted", id: row.id, signature: inspected.signature };
}
