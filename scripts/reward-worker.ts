import { createClient } from "@supabase/supabase-js";
import { exactDatabaseFetch } from "../lib/db/exact-json";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { reconcileLaunchFunding } from "../lib/funding/service";
import { registerLaunchTracker } from "../lib/db/launch-repository";
import { planEpoch, reconcileMarket, reconcilePayoutBatches } from "../lib/worker/pipeline";
import { launchVenue } from "../lib/venue/registry";
import { submitBoundLaunch } from "../lib/venue/launch-submission-service";
import { automaticPayoutReadiness, automaticPayoutsConfigured, processAutomaticPayout } from "../lib/payout/automatic";
import { reconcileStonkForwardedFees } from "../lib/funding/stonk-auto";
import { processCreatorFeeDistribution } from "../lib/funding/creator-distribution";
import { processPumpCreatorFees } from "../lib/funding/pump-auto";
import { provisionStonkReceivers, processStonkReceiver } from "../lib/funding/stonk-isolated";
import { ensureTopblastCreatorLaunch } from "../lib/db/topblast-import";
import { processTopblastCreatorFees } from "../lib/funding/topblast-creator";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && key);
const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: exactDatabaseFetch } }) : null;
const dryRun = process.env.DRY_RUN !== "false";
const owner = `${process.env.RAILWAY_REPLICA_ID ?? "local"}:${process.pid}:${randomUUID()}`;
const port = Number(process.env.PORT ?? 0);
let lastCycleAt: string | null = null;
let lastCycleError: string | null = null;
let needsBackfill = false;

const healthServer = port > 0 ? createServer((request, response) => {
  if (request.url === "/api/live" || request.url === "/") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ live: true, service: "topblast-rewards-worker", configured, dryRun, owner, lastCycleAt, lastCycleError }));
    return;
  }
  response.writeHead(404).end();
}).listen(port, "0.0.0.0") : null;

let stopping = false;
process.on("SIGTERM", () => { stopping = true; healthServer?.close(); });
process.on("SIGINT", () => { stopping = true; healthServer?.close(); });

async function runCycle() {
  if (!db) {
    process.stdout.write(`${new Date().toISOString()} waiting for Supabase configuration; no work performed\n`);
    return;
  }
  lastCycleAt = new Date().toISOString();
  lastCycleError = null;
  needsBackfill = false;
  const signer = automaticPayoutReadiness();
  const { error: heartbeatError } = await db.from("system_config").upsert({
    key: "worker_heartbeat",
    value: { at: lastCycleAt, owner, mode: dryRun ? "dry_run" : "live", payoutMode: automaticPayoutsConfigured() ? "server_signer" : "wallet_approved", signerReady: signer.ready, signerError: signer.error, pipeline: "operational" },
    updated_at: lastCycleAt,
  });
  if (heartbeatError) throw heartbeatError;
  try {
    const result = await ensureTopblastCreatorLaunch(db, owner);
    await db.from("system_config").upsert({ key: "topblast_creator_health", value: { ...result, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TOPBLAST creator registration failed";
    await db.from("system_config").upsert({ key: "topblast_creator_health", value: { status: "error", message, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  }
  try {
    await provisionStonkReceivers(db, owner);
    await db.from("system_config").upsert({ key: "stonk_receiver_health", value: { ready: !dryRun && signer.ready, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  } catch (error) {
    await db.from("system_config").upsert({ key: "stonk_receiver_health", value: { ready: false, at: new Date().toISOString(), error: error instanceof Error ? error.message : "Receiver provisioning failed" }, updated_at: new Date().toISOString() });
  }

  const { data: pendingLaunches } = await db.from("launches").select("id").eq("status", "processing").not("payment_signature", "is", null);
  for (const launch of pendingLaunches ?? []) {
    try { await submitBoundLaunch(launch.id); }
    catch (error) { process.stderr.write(`${launch.id}: launch recovery pending: ${error instanceof Error ? error.message : "unknown error"}\n`); }
  }

  const { data: recoverableLaunches } = await db.from("launches").select("id").eq("status", "active").eq("tracker_status", "failed");
  for (const launch of recoverableLaunches ?? []) {
    try { await registerLaunchTracker(launch.id); }
    catch (error) { process.stderr.write(`${launch.id}: tracker registration retry failed: ${error instanceof Error ? error.message : "unknown error"}\n`); }
  }

  const { data: markets, error: marketError } = await db.from("tracked_markets").select("*").eq("active", true);
  if (marketError) throw marketError;
  // Fee operations share the treasury signer. The database lease permits the
  // same owner to renew it, so Promise.all with one owner is NOT mutual exclusion.
  // Serialize treasury work; independent market indexing remains parallel below.
  for (const market of markets ?? []) {
    if (market.venue === "stonkfun") {
      try {
        const dedicatedTopblast = market.base_mint === process.env.TOPBLAST_TOKEN_MINT && market.creator_address === process.env.TOPBLAST_CREATOR_ADDRESS;
        const result = dedicatedTopblast ? await processTopblastCreatorFees(db, market, owner) : await processStonkReceiver(db, market, owner);
        const legacy = result.status === "legacy_attribution_required" ? await reconcileStonkForwardedFees(db, market) : null;
        const diagnostic = await db.from("system_config").upsert({ key: `stonk_fee_status:${market.launch_id}`, value: { ...result, message: legacy?.reason ?? null, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
        if (diagnostic.error) throw diagnostic.error;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Isolated Stonk receiver failed";
        await db.from("system_config").upsert({ key: `stonk_fee_status:${market.launch_id}`, value: { status: "error", message, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
        process.stderr.write(`${market.launch_id}: ${message}\n`);
      }
    }
    if (market.venue === "pumpfun") {
      try {
        const result = await processPumpCreatorFees(db, market, owner);
        if (!["disabled", "lease_busy", "uncertain"].includes(result.status)) await db.from("system_config").delete().eq("key", `pump_fee_error:${market.launch_id}`);
        if (!['disabled', 'idle'].includes(result.status)) process.stdout.write(`${market.launch_id}: Pump fee routing ${JSON.stringify(result)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Pump fee routing failed";
        await db.from("system_config").upsert({ key: `pump_fee_error:${market.launch_id}`, value: { message, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
        process.stderr.write(`${market.launch_id}: Pump fee routing failed: ${message}\n`);
      }
    }
  }
  await Promise.all((markets ?? []).map(async (market) => {
    let historyReady = false;
    try {
      historyReady = await reconcileMarket(db, market, owner) === true;
      if (!historyReady) needsBackfill = true;
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "market reconciliation failed";
      await db.from("tracked_markets").update({ tracker_error: message, price_status: "failed", updated_at: new Date().toISOString() }).eq("launch_id", market.launch_id);
      process.stderr.write(`${market.launch_id}: ${message}\n`);
    }
    // A venue listing can lag a real onchain launch. Missing optional USD
    // metrics must not mark a successfully reconciled tracker as failed.
    if (historyReady) {
      try {
        const venueMarket = await launchVenue(market.venue).getMarketData(market.base_mint, market.market_address);
        await db.from("launches").update({ price_usd: venueMarket.priceUsd, market_cap_usd: venueMarket.marketCapUsd, volume_24h_usd: venueMarket.volume24hUsd, liquidity_usd: venueMarket.liquidityUsd, updated_at: new Date().toISOString() }).eq("id", market.launch_id);
      } catch (error) { process.stderr.write(`${market.launch_id}: optional venue metrics unavailable: ${error instanceof Error ? error.message : "unknown error"}\n`); }
    }
  }));

  const { data: funding } = await db.from("funding_intents").select("id").in("status", ["submitted", "uncertain"]);
  for (const intent of funding ?? []) {
    try { await reconcileLaunchFunding(intent.id); }
    catch (error) { process.stderr.write(`${intent.id}: funding reconciliation failed: ${error instanceof Error ? error.message : "unknown error"}\n`); }
  }
  await reconcilePayoutBatches(db);

  const { data: pauseRow, error: pauseError } = await db.from("system_config").select("value").eq("key", "reward_engine_paused").maybeSingle();
  if (pauseError) throw pauseError;
  if (pauseRow?.value !== false) {
    process.stdout.write(`${lastCycleAt} tracking and reconciliation complete; new epochs paused\n`);
    return;
  }
  const refreshed = await db.from("tracked_markets").select("*").eq("active", true).eq("history_complete", true);
  if (refreshed.error) throw refreshed.error;
  for (const market of refreshed.data ?? []) {
    try { await planEpoch(db, market, owner); }
    catch (error) {
      const message = error instanceof Error ? error.message : "epoch planning failed";
      await db.from("system_config").upsert({ key: `epoch_error:${market.launch_id}`, value: { message, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
      process.stderr.write(`${market.launch_id}: ${message}\n`);
    }
  }
  try {
    const creatorDistribution = await processCreatorFeeDistribution(db, owner);
    if (creatorDistribution.status !== "disabled" && creatorDistribution.status !== "idle") process.stdout.write(`${new Date().toISOString()} creator distribution ${JSON.stringify(creatorDistribution)}\n`);
    const payout = ["idle", "confirmed", "disabled"].includes(creatorDistribution.status)
      ? await processAutomaticPayout(db, owner, process.env, creatorDistribution.leasedTreasury)
      : { status: "lease_busy" as const };
    if (payout.status !== "disabled" && payout.status !== "idle") process.stdout.write(`${new Date().toISOString()} payout ${JSON.stringify(payout)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "automatic payout failed";
    await db.from("system_config").upsert({ key: "automatic_payout_error", value: { message, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
    process.stderr.write(`automatic payout: ${message}\n`);
  }
}

const pollSeconds = Math.max(10, Number(process.env.REWARD_WORKER_POLL_SECONDS ?? 30));
async function main() {
  do {
    try { await runCycle(); }
    catch (error) {
      lastCycleError = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`${new Date().toISOString()} worker error: ${lastCycleError}\n`);
    }
    if (process.env.REWARD_WORKER_ONCE === "true" || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, needsBackfill ? 1_000 : pollSeconds * 1_000));
  } while (!stopping);
}

main().catch((error) => {
  process.stderr.write(`${new Date().toISOString()} fatal worker error: ${error instanceof Error ? error.message : "unknown error"}\n`);
  healthServer?.close();
  process.exitCode = 1;
});
