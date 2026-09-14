import { createClient } from "@supabase/supabase-js";
import { splitFundedFees } from "../lib/rewards/calculator";
import { StonkFunAdapter } from "../lib/venue/stonkfun-adapter";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false } });
const venue = new StonkFunAdapter();
const dryRun = process.env.DRY_RUN !== "false";

const { data: pauseRow } = await db.from("system_config").select("value").eq("key", "reward_engine_paused").maybeSingle();
if (pauseRow?.value !== false) {
  process.stdout.write("Reward engine is paused in system_config.\n");
  process.exit(0);
}

const { data: launches, error } = await db.from("launches").select("id,mint,creator_wallet,launch_configs(*)").eq("status", "active");
if (error) throw error;

for (const launch of launches ?? []) {
  if (!launch.mint) continue;
  const fees = await venue.getCreatorFees(launch.mint);
  process.stdout.write(`${launch.id}: venue fees ${fees.claimable ? "claimable by creator signature" : fees.reason ?? "auto-forwarded or none"}\n`);
  const { data: events, error: eventError } = await db.from("fee_events").select("*").eq("launch_id", launch.id).eq("status", "confirmed");
  if (eventError) throw eventError;
  const config = Array.isArray(launch.launch_configs) ? launch.launch_configs[0] : launch.launch_configs;
  for (const event of events ?? []) {
    const { data: existing } = await db.from("fee_allocations").select("id").eq("launch_id", launch.id).eq("fee_event_id", event.id).maybeSingle();
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
    throw new Error("Live fee allocation is disabled until a payout signer provider and per-launch treasury deposit flow are configured");
  }
}
