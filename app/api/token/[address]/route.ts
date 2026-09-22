import { NextResponse } from "next/server";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { tokenMarketData } from "@/lib/token-market-data";
import { recentTokenTrades, mergeTokenTrades } from "@/lib/token-trades";

export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const { address } = await context.params;
  const db = getAdminDb();
  let query = db.from("launches").select("*,launch_configs(*)").eq("mint", address);
  if (!isAdminRequest(_request)) query = query.eq("is_test", false);
  const { data: launch, error } = await query.single();
  if (error || !launch) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  const [{ data: epochs }, { data: distributions }, { data: proofs }, { data: funding }, { data: deposits }, { data: prices }, { data: market }, { data: allocations }, { data: batches }, { data: engine }, trades, holders] = await Promise.all([
    db.from("reward_epochs").select("id,sequence,status,start_slot,snapshot_slot,start_time,end_time,reference_price_quote_atoms,funded_budget_atoms,distributed_atoms,allocation_hash,created_at,completed_at").eq("launch_id", launch.id).order("sequence", { ascending: false }).limit(25),
    db.from("reward_distributions").select("amount_atoms,status").eq("launch_id", launch.id).eq("status", "confirmed"),
    db.from("transaction_proofs").select("epoch_id,kind,signature,slot,payload,created_at").eq("launch_id", launch.id).order("created_at", { ascending: false }).limit(200),
    db.from("launch_funding_balances").select("*").eq("launch_id", launch.id).maybeSingle(),
    db.from("funding_deposits").select("signature,sender_wallet,recipient_wallet,asset_mint,amount_atoms,gross_amount_atoms,protocol_amount_atoms,slot,block_time,proof").eq("launch_id", launch.id).order("block_time", { ascending: false }).limit(100),
    db.from("price_observations").select("slot,block_time,price_quote_atoms_per_token,source").eq("launch_id", launch.id).order("slot", { ascending: false }).limit(2000),
    db.from("tracked_markets").select("*").eq("launch_id", launch.id).maybeSingle(),
    db.from("reward_allocations").select("epoch_id,wallet,amount_atoms,eligible_loss_quote_atoms").eq("launch_id", launch.id).limit(5000),
    db.from("payout_batches").select("id,epoch_id,status,amount_atoms,manifest_hash,signature,submitted_at,confirmed_at,error_message").eq("launch_id", launch.id).order("created_at", { ascending: false }),
    db.from("system_config").select("value").eq("key", "reward_engine_paused").maybeSingle(),
    db.from("wallet_activity").select("id,wallet,signature,event_index,kind,token_raw,quote_atoms,slot,block_time").eq("launch_id", launch.id).in("kind", ["verified_buy", "sell"]).order("slot", { ascending: false }).order("event_index", { ascending: false }).limit(100),
    db.from("wallet_positions").select("wallet", { count: "exact", head: true }).eq("launch_id", launch.id).gt("balance_raw", 0),
  ]);
  const [marketData, recent] = await Promise.all([
    market ? tokenMarketData(market) : { status: "unavailable", error: "Market is not registered yet" },
    market ? recentTokenTrades(market) : { trades: [], available: false, partial: true },
  ]);
  const total = (distributions ?? []).reduce((sum, item) => sum + BigInt(item.amount_atoms), 0n);
  return NextResponse.json({ launch, market, marketData, funding, deposits: deposits ?? [], prices: (prices ?? []).reverse(),
    trades: mergeTokenTrades(trades.data ?? [], recent.trades), tradesAvailable: !trades.error || recent.available, tradesPartial: recent.partial, trackedHolders: holders.error ? null : holders.count,
    allocations: allocations ?? [], batches: batches ?? [], epochs: epochs ?? [], proofs: proofs ?? [], enginePaused: engine?.value !== false, totalRewardedAtoms: total.toString() });
}
