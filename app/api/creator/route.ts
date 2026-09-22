import { NextResponse } from "next/server";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";
import { isAddress } from "@solana/addresses";
import { launchVenue } from "@/lib/venue/registry";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ error: "A valid Solana wallet is required" }, { status: 400 });
  if (!isDatabaseConfigured()) return NextResponse.json({ launches: [], configured: false });
  const db = getAdminDb();
  const { data, error } = await db.from("launches").select("id,is_test,public_test_listing,listing_hidden,venue,mint,market_address,launch_signature,name,symbol,status,tracker_status,tracker_error,volume_24h_usd,launch_configs(*),tracked_markets(base_decimals,quote_decimals,history_complete,last_indexed_slot,tracker_error),reward_epochs(id,sequence,status,snapshot_slot,funded_budget_atoms,distributed_atoms),reward_distributions(amount_atoms,status,signature),fee_events(amount_atoms,status),launch_funding_balances(*),funding_deposits(signature,gross_amount_atoms,amount_atoms,block_time),payout_batches(id,epoch_id,status,amount_atoms,signature,error_message)").eq("creator_wallet", wallet).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const launches = await Promise.all((data ?? []).map(async (launch) => {
    if (!launch.mint) return { ...launch, venue_fee_status: { claimable: null, reason: "Token launch is not finalized yet" } };
    try { return { ...launch, venue_fee_status: await launchVenue(launch.venue).getCreatorFees(launch.mint) }; }
    catch (caught) { return { ...launch, venue_fee_status: { claimable: null, reason: caught instanceof Error ? caught.message : "Venue fee status unavailable" } }; }
  }));
  return NextResponse.json({ launches, configured: true });
}
