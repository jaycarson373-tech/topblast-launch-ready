import { createClient } from "@supabase/supabase-js";
import { createServer } from "node:http";
import { splitFundedFees } from "../lib/rewards/calculator";
import { StonkFunAdapter } from "../lib/venue/stonkfun-adapter";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false } });
const venue = new StonkFunAdapter();
const dryRun = process.env.DRY_RUN !== "false";

const port = Number(process.env.PORT ?? 0);
const healthServer = port > 0 ? createServer((request, response) => {
  if (request.url === "/api/live" || request.url === "/") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ live: true, service: "topblast-rewards-worker", dryRun }));
    return;
  }
  response.writeHead(404).end();
}).listen(port, "0.0.0.0") : null;

let stopping = false;
process.on("SIGTERM", () => { stopping = true; healthServer?.close(); });
process.on("SIGINT", () => { stopping = true; healthServer?.close(); });

async function runCycle() {
  const heartbeat = { at: new Date().toISOString(), mode: dryRun ? "dry_run" : "live", payoutMode: process.env.PAYOUT_MODE ?? "manual_wallet" };
  const { error: heartbeatError } = await db.from("system_config").upsert({ key: "worker_heartbeat", value: heartbeat, updated_at: heartbeat.at });
  if (heartbeatError) throw heartbeatError;

  const { data: pauseRow, error: pauseError } = await db.from("system_config").select("value").eq("key", "reward_engine_paused").maybeSingle();
  if (pauseError) throw pauseError;
  if (pauseRow?.value !== false) {
    process.stdout.write(`${heartbeat.at} reward engine paused; monitoring only\n`);
    return;
  }

  const { data: launches, error } = await db.from("launches").select("id,mint,creator_wallet,launch_configs(*)").eq("status", "active");
  if (error) throw error;

  for (const launch of launches ?? []) {
    if (!launch.mint) continue;
    try {
      const fees = await venue.getCreatorFees(launch.mint);
      process.stdout.write(`${launch.id}: venue fees ${fees.claimable ? "claimable by creator signature" : fees.reason ?? "auto-forwarded or none"}\n`);
      const { data: events, error: eventError } = await db.from("fee_events").select("*").eq("launch_id", launch.id).eq("status", "confirmed");
      if (eventError) throw eventError;
      const config = Array.isArray(launch.launch_configs) ? launch.launch_configs[0] : launch.launch_configs;
      if (!config) throw new Error("Launch configuration is missing");
      for (const event of events ?? []) {
        const { data: existing, error: existingError } = await db.from("fee_allocations").select("id").eq("launch_id", launch.id).eq("fee_event_id", event.id).maybeSingle();
        if (existingError) throw existingError;
        if (existing) continue;
        const allocation = splitFundedFees(launch.id, event.launch_id, BigInt(event.amount_atoms), {
          topblastPercent: config.topblast_percent,
          creatorPercent: config.creator_percent,
          protocolPercent: config.protocol_percent,
        });
        if (dryRun) {
          process.stdout.write(`${launch.id}: DRY RUN would allocate ${allocation.topblast} reward atoms from fee event ${event.id}\n`);
          continue;
        }
        throw new Error("Live allocation requires an approved deposit flow and remains intentionally locked");
      }
    } catch (error) {
      process.stderr.write(`${launch.id}: ${error instanceof Error ? error.message : "worker cycle failed"}\n`);
    }
  }
}

const pollSeconds = Math.max(10, Number(process.env.REWARD_WORKER_POLL_SECONDS ?? 30));
do {
  try { await runCycle(); }
  catch (error) { process.stderr.write(`${new Date().toISOString()} worker error: ${error instanceof Error ? error.message : "unknown error"}\n`); }
  if (process.env.REWARD_WORKER_ONCE === "true" || stopping) break;
  await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1_000));
} while (!stopping);
