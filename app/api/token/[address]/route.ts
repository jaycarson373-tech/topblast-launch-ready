import { NextResponse } from "next/server";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const { address } = await context.params;
  const db = getAdminDb();
  const { data: launch, error } = await db.from("launches").select("*,launch_configs(*)").eq("mint", address).single();
  if (error || !launch) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  const [{ data: epochs }, { data: distributions }, { data: proofs }] = await Promise.all([
    db.from("reward_epochs").select("id,sequence,status,snapshot_slot,funded_budget_atoms,distributed_atoms,created_at,completed_at").eq("launch_id", launch.id).order("sequence", { ascending: false }).limit(25),
    db.from("reward_distributions").select("amount_atoms,status").eq("launch_id", launch.id).eq("status", "confirmed"),
    db.from("transaction_proofs").select("epoch_id,kind,signature,slot,payload,created_at").eq("launch_id", launch.id).order("created_at", { ascending: false }).limit(200),
  ]);
  const total = (distributions ?? []).reduce((sum, item) => sum + BigInt(item.amount_atoms), 0n);
  return NextResponse.json({ launch, epochs: epochs ?? [], proofs: proofs ?? [], totalRewardedAtoms: total.toString() });
}
