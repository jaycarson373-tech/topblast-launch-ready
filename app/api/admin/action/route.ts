import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";
import { getTreasuryBalance, solanaRpc } from "@/lib/solana/rpc";
import { getLaunchWallet } from "@/lib/payout/launch-wallet";

function authorized(request: Request) {
  const expected = process.env.ADMIN_API_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && Buffer.byteLength(expected) === Buffer.byteLength(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminDb();
  const [launches, markets, failedEpochs, failedPayouts, fees, config, balances, inboxFailures, approvals] = await Promise.all([
    db.from("launches").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("tracked_markets").select("launch_id,last_indexed_slot,updated_at,tracker_error,history_complete,price_status").eq("active", true).order("last_indexed_slot"),
    db.from("reward_epochs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("payout_batches").select("id", { count: "exact", head: true }).in("status", ["failed", "uncertain"]),
    db.from("fee_events").select("asset_mint,amount_atoms").in("status", ["detected", "confirmed"]),
    db.from("system_config").select("key,value"),
    db.from("launch_funding_balances").select("asset_mint,available_atoms,reserved_atoms,submitted_atoms,paid_atoms"),
    db.from("chain_event_inbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("payout_batches").select("id,launch_id,epoch_id,sequence,amount_atoms,status,manifest_hash").in("status", ["planned", "prepared", "submitted", "uncertain"]).order("created_at"),
  ]);
  const observedFees: Record<string, string> = {};
  for (const item of fees.data ?? []) observedFees[item.asset_mint] = (BigInt(observedFees[item.asset_mint] ?? 0) + BigInt(item.amount_atoms)).toString();
  const treasuryAddress = process.env.TOPBLAST_TREASURY_ADDRESS;
  const rewardMint = process.env.STONK_QUOTE_MINT;
  let treasuryBalances: unknown = "NOT CONFIGURED";
  let finalizedSlot: number | null = null;
  if (treasuryAddress) {
    try { treasuryBalances = await getTreasuryBalance(treasuryAddress, rewardMint); }
    catch (error) { treasuryBalances = { address: treasuryAddress, error: error instanceof Error ? error.message : "RPC check failed" }; }
  }
  try { finalizedSlot = await solanaRpc<number>("getSlot", [{ commitment: "finalized" }]); } catch { /* reported as unavailable */ }
  const rows = markets.data ?? [];
  const lastIndexed = rows.length ? Math.min(...rows.map((item) => Number(item.last_indexed_slot))) : null;
  const fundingTotals: Record<string, Record<string, string>> = {};
  for (const item of balances.data ?? []) {
    const amounts = fundingTotals[item.asset_mint] ??= { available: "0", reserved: "0", submitted: "0", paid: "0" };
    for (const name of ["available", "reserved", "submitted", "paid"] as const) amounts[name] = (BigInt(amounts[name]) + BigInt(item[`${name}_atoms`])).toString();
  }
  const heartbeat = config.data?.find((item) => item.key === "worker_heartbeat")?.value as { at?: string; payoutMode?: string } | undefined;
  const workerFresh = Boolean(heartbeat?.at && Date.now() - new Date(heartbeat.at).getTime() < 180_000);
  const trackerHealth = !rows.length ? "NO MARKETS" : rows.some((item) => item.tracker_error || item.price_status === "failed") ? "DEGRADED" : rows.every((item) => item.history_complete) ? "CAUGHT UP" : "BACKFILLING";
  return NextResponse.json({ activeLaunches: launches.count ?? 0, trackerHealth, workerFresh, workerHeartbeat: heartbeat ?? null, lastIndexedBlock: lastIndexed, finalizedSlot, indexingLag: finalizedSlot !== null && lastIndexed !== null ? finalizedSlot - lastIndexed : null, failedEpochs: failedEpochs.count ?? 0, failedPayouts: failedPayouts.count ?? 0, reconciliationProblems: inboxFailures.count ?? 0, observedCreatorFeesByAsset: observedFees, fundingBalances: fundingTotals, treasuryBalances, payoutMode: heartbeat?.payoutMode ?? "wallet_approved", dryRun: process.env.DRY_RUN !== "false", pendingApprovalBatches: approvals.data ?? [], config: config.data ?? [] });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { action?: string; launchId?: string; epochId?: string };
  const db = getAdminDb();
  if (body.action === "resume_engine") {
    const { data: heartbeat, error } = await db.from("system_config").select("value").eq("key", "worker_heartbeat").single();
    if (error || !heartbeat?.value?.at || Date.now() - new Date(heartbeat.value.at).getTime() > 180_000) return NextResponse.json({ error: "A healthy worker is required" }, { status: 409 });
    const result = await db.from("system_config").upsert({ key: "reward_engine_paused", value: false, updated_at: new Date().toISOString() });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, dryRun: process.env.DRY_RUN !== "false", payoutMode: heartbeat.value?.payoutMode ?? "wallet_approved" });
  }
  if (body.action === "pause_engine") {
    const { error } = await db.from("system_config").upsert({ key: "reward_engine_paused", value: true, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "pause_launch" && body.launchId) {
    const { error } = await db.from("launches").update({ status: "paused" }).eq("id", body.launchId).eq("status", "active");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "retry_epoch" && body.epochId) {
    const { error } = await db.from("reward_epochs").update({ status: "pending", failed_step: null, failure_message: null }).eq("id", body.epochId).eq("status", "failed");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "dry_run_payout" && body.epochId) {
    const { data, error } = await db.from("reward_allocations").select("wallet,amount_atoms").eq("epoch_id", body.epochId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const total = (data ?? []).reduce((sum, row) => sum + BigInt(row.amount_atoms), 0n);
    return NextResponse.json({ ok: true, dryRun: true, wallets: data?.length ?? 0, totalAtoms: total.toString(), note: "No transaction created or signed" });
  }
  if (body.action === "payout_manifest" && body.epochId) {
    const { data: epoch, error: epochError } = await db.from("reward_epochs").select("id,launch_id,reward_asset_mint,funded_budget_atoms,status").eq("id", body.epochId).single();
    if (epochError) return NextResponse.json({ error: epochError.message }, { status: 500 });
    const { data, error } = await db.from("reward_allocations").select("launch_id,wallet,amount_atoms").eq("epoch_id", body.epochId).eq("launch_id", epoch.launch_id).order("wallet");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const allocations = data ?? [];
    if (allocations.some((row) => row.launch_id !== epoch.launch_id)) return NextResponse.json({ error: "Cross-launch contamination detected" }, { status: 409 });
    const totalAtoms = allocations.reduce((sum, row) => sum + BigInt(row.amount_atoms), 0n);
    if (totalAtoms > BigInt(epoch.funded_budget_atoms)) return NextResponse.json({ error: "Manifest exceeds funded epoch budget" }, { status: 409 });
    const payoutWallet = await getLaunchWallet(db, epoch.launch_id);
    const manifest = { version: 1, cluster: "solana:mainnet", epochId: epoch.id, launchId: epoch.launch_id, rewardAssetMint: epoch.reward_asset_mint, treasuryAddress: payoutWallet.address, totalAtoms: totalAtoms.toString(), allocations: allocations.map((row) => ({ wallet: row.wallet, amountAtoms: String(row.amount_atoms) })) };
    const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    return NextResponse.json({ ok: true, dryRun: true, requiresWalletApproval: true, manifestHash: hash, manifest });
  }
  return NextResponse.json({ error: "Unsupported admin action" }, { status: 400 });
}
