"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LaunchSummary } from "@/lib/types";

type Sort = "TRENDING" | "NEW" | "MOST REWARDED" | "MOST VOLUME";
const money = (value: number | null) => value === null ? "Pending" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact" }).format(value);

export function ExploreGrid() {
  const [launches, setLaunches] = useState<LaunchSummary[]>([]);
  const [configured, setConfigured] = useState(true);
  const [sort, setSort] = useState<Sort>("NEW");
  useEffect(() => { fetch("/api/launches").then((response) => response.json()).then((body) => { setLaunches(body.launches ?? []); setConfigured(body.configured !== false); }); }, []);
  const sorted = useMemo(() => [...launches].sort((a, b) => {
    if (sort === "NEW") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "MOST REWARDED") return BigInt(b.totalRewardedAtoms) > BigInt(a.totalRewardedAtoms) ? 1 : -1;
    if (sort === "MOST VOLUME") return (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1);
    return ((b.volume24hUsd ?? 0) + Number(BigInt(b.totalRewardedAtoms))) - ((a.volume24hUsd ?? 0) + Number(BigInt(a.totalRewardedAtoms)));
  }), [launches, sort]);
  return <><div className="tabs">{(["TRENDING","NEW","MOST REWARDED","MOST VOLUME"] as Sort[]).map((item) => <button key={item} className={sort === item ? "active" : ""} onClick={() => setSort(item)}>{item}</button>)}</div>{sorted.length ? <div className="cards">{sorted.map((launch) => <Link href={`/token/${launch.mint}`} className="token-card" key={launch.id}><div className="token-card-head"><div><h3>{launch.name}</h3><span className="ticker">${launch.symbol}</span></div><span className="status-pill">TOPBLAST</span></div><div className="metrics"><div className="metric"><span>Pair</span><strong>{launch.symbol} / {launch.quoteSymbol}</strong></div><div className="metric"><span>Market cap</span><strong>{money(launch.marketCapUsd)}</strong></div><div className="metric"><span>24h volume</span><strong>{money(launch.volume24hUsd)}</strong></div><div className="metric"><span>Eligible</span><strong>{launch.eligibleWallets}</strong></div></div></Link>)}</div> : <div className="empty">{configured ? "No completed TopBlast launches yet." : "Connect Supabase and run the migration to load real launches."}</div>}</>;
}
