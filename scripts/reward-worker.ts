import { createClient } from "@supabase/supabase-js";
import { exactDatabaseFetch } from "../lib/db/exact-json";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { reconcileLaunchFunding } from "../lib/funding/service";
import { registerLaunchTracker } from "../lib/db/launch-repository";
import { planEpoch, reconcileMarket, reconcilePayoutBatches } from "../lib/worker/pipeline";
import { launchVenue } from "../lib/venue/registry";
import { submitBoundLaunch } from "../lib/venue/launch-submission-service";

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
  const { error: heartbeatError } = await db.from("system_config").upsert({
    key: "worker_heartbeat",
    value: { at: lastCycleAt, owner, mode: dryRun ? "dry_run" : "approval_required", payoutMode: "wallet_approved", pipeline: "operational" },
    updated_at: lastCycleAt,
  });
  if (heartbeatError) throw heartbeatError;

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
  for (const market of markets ?? []) {
    try {
      if (await reconcileMarket(db, market, owner) === false) needsBackfill = true;
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "market reconciliation failed";
      await db.from("tracked_markets").update({ tracker_error: message, price_status: "failed", updated_at: new Date().toISOString() }).eq("launch_id", market.launch_id);
      process.stderr.write(`${market.launch_id}: ${message}\n`);
    }
    // A venue listing can lag a real onchain launch. Missing optional USD
    // metrics must not mark a successfully reconciled tracker as failed.
    try {
      const venueMarket = await launchVenue(market.venue).getMarketData(market.base_mint, market.market_address);
      await db.from("launches").update({ price_usd: venueMarket.priceUsd, market_cap_usd: venueMarket.marketCapUsd, volume_24h_usd: venueMarket.volume24hUsd, liquidity_usd: venueMarket.liquidityUsd, updated_at: new Date().toISOString() }).eq("id", market.launch_id);
    } catch (error) { process.stderr.write(`${market.launch_id}: optional venue metrics unavailable: ${error instanceof Error ? error.message : "unknown error"}\n`); }
  }

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
