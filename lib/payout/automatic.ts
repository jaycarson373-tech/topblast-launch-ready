import type { SupabaseClient } from "@supabase/supabase-js";
import { preparePayoutBatch, reconcilePayoutBatch, submitPayoutBatch } from "@/lib/payout/service";
import { createRailwaySigner } from "@/lib/payout/railway-signer";

export type AutomaticPayoutResult =
  | { status: "disabled" | "lease_busy" | "idle" }
  | { status: "awaiting_finality"; batchId: string; signature: string | null }
  | { status: "authorization_limit"; batchId: string; amountAtoms: string; limitAtoms: string }
  | { status: "submitted" | "confirmed"; batchId: string; signature: string | null };

function payoutLimit(env: NodeJS.ProcessEnv) {
  const raw = env.TOPBLAST_MAX_PAYOUT_ATOMS;
  if (!raw || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("TOPBLAST_MAX_PAYOUT_ATOMS must be a positive integer when server payouts are enabled");
  }
  return BigInt(raw);
}

export function automaticPayoutsConfigured(env: NodeJS.ProcessEnv = process.env) {
  return env.PAYOUT_MODE === "server_signer" && env.DRY_RUN === "false";
}

export function automaticPayoutReadiness(env: NodeJS.ProcessEnv = process.env) {
  if (!automaticPayoutsConfigured(env)) return { ready: false, error: "Automatic payouts are not enabled" };
  try {
    const treasury = env.TOPBLAST_TREASURY_ADDRESS;
    if (!treasury) throw new Error("TOPBLAST_TREASURY_ADDRESS is missing");
    if (createRailwaySigner(env as Record<string, string | undefined>).publicKey() !== treasury) throw new Error("Treasury signer does not match the configured treasury");
    payoutLimit(env);
    return { ready: true, error: null };
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message : "Treasury signer is unavailable" };
  }
}

export async function processAutomaticPayout(
  db: SupabaseClient,
  owner: string,
  env: NodeJS.ProcessEnv = process.env,
  treasuryLeaseHeld = false,
): Promise<AutomaticPayoutResult> {
  if (!automaticPayoutsConfigured(env)) return { status: "disabled" };
  const treasury = env.TOPBLAST_TREASURY_ADDRESS;
  if (!treasury) throw new Error("TOPBLAST_TREASURY_ADDRESS is required for automatic payouts");
  const signer = createRailwaySigner(env as Record<string, string | undefined>);
  if (signer.publicKey() !== treasury) throw new Error("TREASURY_PRIVATE_KEY does not match TOPBLAST_TREASURY_ADDRESS");
  const limit = payoutLimit(env);
  if (!treasuryLeaseHeld) {
    const lease = await db.rpc("claim_worker_lease", {
      p_resource_type: "payout_treasury", p_resource_id: treasury, p_owner_id: owner, p_seconds: 60,
    });
    if (lease.error) throw lease.error;
    if (lease.data !== true) return { status: "lease_busy" };
  }

  const inFlight = await db.from("payout_batches").select("id,status,signature").in("status", ["signed", "submitted", "uncertain"]).order("created_at", { ascending: true });
  if (inFlight.error) throw inFlight.error;
  for (const batch of inFlight.data ?? []) {
    const result = await reconcilePayoutBatch(batch.id);
    if (result.status !== "confirmed") {
      return { status: "awaiting_finality", batchId: batch.id, signature: result.signature ?? batch.signature ?? null };
    }
  }

  let selected = await db.from("payout_batches").select("*").eq("status", "prepared").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (selected.error) throw selected.error;
  if (!selected.data) {
    const planned = await db.from("payout_batches").select("id,amount_atoms").eq("status", "planned").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (planned.error) throw planned.error;
    if (!planned.data) return { status: "idle" };
    if (BigInt(planned.data.amount_atoms) > limit) return { status: "authorization_limit", batchId: planned.data.id, amountAtoms: planned.data.amount_atoms, limitAtoms: limit.toString() };
    await preparePayoutBatch(planned.data.id);
    selected = await db.from("payout_batches").select("*").eq("id", planned.data.id).single();
    if (selected.error) throw selected.error;
  }
  const batch = selected.data;
  if (BigInt(batch.amount_atoms) > limit) return { status: "authorization_limit", batchId: batch.id, amountAtoms: batch.amount_atoms, limitAtoms: limit.toString() };
  if (!batch.unsigned_transaction || !batch.unsigned_message_hash) throw new Error("Prepared payout is missing the exact transaction bytes");
  const signed = signer.signTransaction({
    transactionBase64: batch.unsigned_transaction,
    expectedMessageHash: batch.unsigned_message_hash,
    expectedPayer: treasury,
  });
  const result = await submitPayoutBatch(batch.id, signed);
  return {
    status: result.status === "confirmed" ? "confirmed" : "submitted",
    batchId: batch.id,
    signature: result.signature ?? null,
  };
}
