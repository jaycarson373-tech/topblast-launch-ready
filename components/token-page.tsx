"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { PriceChart } from "@/components/price-chart";

const display = (value: unknown, fallback = "Unavailable") => value === null || value === undefined ? fallback : String(value);
const money = (value: unknown) => typeof value === "number" ? new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value) : "Unavailable";
const short = (value: unknown) => { const text = String(value ?? ""); return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-8)}` : text; };
function atoms(value: unknown, decimals: number) {
  const raw = BigInt(String(value ?? "0")); const scale = 10n ** BigInt(decimals);
  return `${raw / scale}.${(raw % scale).toString().padStart(decimals, "0").slice(0, Math.min(decimals, 6))}`.replace(/\.?0+$/, "");
}

export function TokenPage({ address }: { address: string }) {
  const [data, setData] = useState<{
    launch: Record<string, unknown>; market: Record<string, unknown> | null; funding: Record<string, unknown> | null;
    epochs: Record<string, unknown>[]; prices: Array<{ block_time: string; price_quote_atoms_per_token: string }>;
    allocations: Record<string, unknown>[]; deposits: Record<string, unknown>[]; totalRewardedAtoms: string; enginePaused: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [wallet, setWallet] = useState("");
  const [holder, setHolder] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { fetch(`/api/token/${address}`, { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); }).catch((caught) => setError(caught.message)); }, [address]);
  async function lookup() { setError(""); setHolder(null); try { const response = await fetch(`/api/token/${address}/wallet/${encodeURIComponent(wallet)}`); const body = await response.json(); if (!response.ok) { setError(body.error); return; } setHolder(body); } catch { setError("Wallet lookup failed. Please try again."); } }
  if (error && !data) return <main className="page shell"><div className="error">{error}</div></main>;
  if (!data) return <main className="page shell"><div className="empty">Loading verified launch data...</div></main>;
  const launch = data.launch;
  const config = Array.isArray(launch.launch_configs) ? launch.launch_configs[0] : launch.launch_configs;
  const market = data.market;
  const funding = data.funding;
  const epochs = data.epochs as Record<string, unknown>[];
  const latest = data.prices.at(-1);
  const quoteDecimals = Number(market?.quote_decimals ?? 9);
  const tracked = launch.tracker_status === "active";
  const funded = BigInt(String(funding?.available_atoms ?? 0)) + BigInt(String(funding?.reserved_atoms ?? 0)) + BigInt(String(funding?.submitted_atoms ?? 0)) > 0n;
  const status = !tracked ? "TRACKER ACTION NEEDED" : funded ? data.enginePaused ? "FUNDED · EPOCHS PAUSED" : "TOPBLAST FUNDED" : "TRACKING ACTIVE · NOT FUNDED";
  const eligible = (data.allocations as Array<Record<string, unknown>>).filter((item) => item.epoch_id === epochs[0]?.id).length;
  return <main>
    <section className="token-hero"><div className="shell token-hero-grid"><div><span className="status-pill">{status}</span><h1>{String(launch.name)}<span>${String(launch.symbol)} · {String(launch.symbol)} / {String(launch.quote_symbol)}</span></h1><p className="mono">{address}</p></div>{Boolean(launch.image_url) && <Image unoptimized className="token-logo-large" width={120} height={120} src={String(launch.image_url)} alt={`${String(launch.name)} token`} />}</div></section>
    <div className="shell page">
      <div className="token-actions"><a className="button" href={`https://www.stonkfun.xyz/token/${address}`} target="_blank" rel="noreferrer">Trade on StonkFun</a><Link className="button button-secondary" href={`/token/${address}/proof`}>View public proof</Link></div>
      <div className="stats-grid"><div className="metric"><span>Finalized price</span><strong>{latest ? `${atoms(latest.price_quote_atoms_per_token, quoteDecimals)} STONK` : "Unavailable"}</strong></div><div className="metric"><span>Market cap</span><strong>{money(launch.market_cap_usd)}</strong></div><div className="metric"><span>24h volume</span><strong>{money(launch.volume_24h_usd)}</strong></div><div className="metric"><span>Liquidity</span><strong>{money(launch.liquidity_usd)}</strong></div></div>
      <PriceChart points={data.prices} decimals={quoteDecimals} />
      <div className="stats-grid"><div className="metric"><span>Available reward pool</span><strong>{atoms(funding?.available_atoms, quoteDecimals)} STONK</strong></div><div className="metric"><span>Eligible wallets</span><strong>{eligible}</strong></div><div className="metric"><span>Total paid</span><strong>{atoms(data.totalRewardedAtoms, quoteDecimals)} STONK</strong></div><div className="metric"><span>Next epoch</span><strong>{data.enginePaused ? "Paused" : tracked ? "Scheduled by worker" : "Tracker unavailable"}</strong></div></div>
      <section className="funding-strip"><div><div className="section-label">Funding mode</div><h3>Verified creator deposits</h3><p>StonkFun forwards creator fees to the creator wallet. This launch is funded only by explicit, finalized deposits attributed to this launch. Automatic fee routing is not advertised.</p></div><div className="funding-ledger"><span>Available <strong>{atoms(funding?.available_atoms, quoteDecimals)}</strong></span><span>Reserved <strong>{atoms(funding?.reserved_atoms, quoteDecimals)}</strong></span><span>Submitted <strong>{atoms(funding?.submitted_atoms, quoteDecimals)}</strong></span><span>Paid <strong>{atoms(funding?.paid_atoms, quoteDecimals)}</strong></span></div></section>
      {(data.deposits as Array<Record<string, unknown>>).length > 0 && <section className="panel"><div className="section-label">Funding receipts</div><div className="receipt-list">{data.deposits.map((deposit: Record<string, unknown>) => <a key={String(deposit.signature)} href={`https://solscan.io/tx/${deposit.signature}`} target="_blank" rel="noreferrer"><span>{new Date(String(deposit.block_time)).toLocaleString()}</span><strong>{atoms(deposit.amount_atoms, quoteDecimals)} STONK to rewards</strong><small>{short(deposit.signature)}</small></a>)}</div></section>}
      <section className="how"><div><div className="eyebrow">BLAST ZONE</div><h2>YOUR ENTRY<br />SETS THE LINE.</h2><p className="notice">Fixed allocation: {display(config?.topblast_percent)}% rewards, {display(config?.creator_percent)}% creator retained, {display(config?.protocol_percent)}% protocol.</p></div><div className="blast-diagram"><div><span>YOUR VERIFIED ENTRY</span><b /></div><p>Current price below</p><div className="blast-zone">BLAST ZONE</div><small>Below your verified entry. Still holding. Eligible for funded TopBlast rewards.</small></div></section>
      <section className="panel"><div className="section-label">Holder lookup</div><h3>Check a wallet</h3><div className="lookup"><input value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="Wallet address" /><button className="button" onClick={lookup}>Check</button></div>{error && <div className="error" role="alert">{error}</div>}{holder && <div className="stats-grid"><div className="metric"><span>Average entry</span><strong>{display(holder.averageEntry)}</strong></div><div className="metric"><span>Current value</span><strong>{display(holder.currentValue)}</strong></div><div className="metric"><span>Draw down</span><strong>{display(holder.drawdown)}</strong></div><div className="metric"><span>Status</span><strong>{display(holder.status)}</strong></div><div className="metric"><span>Eligible units</span><strong>{display(holder.eligibleUnits)}</strong></div><div className="metric"><span>Rewards received</span><strong>{display(holder.rewardsReceived)}</strong></div></div>}</section>
    </div>
  </main>;
}
