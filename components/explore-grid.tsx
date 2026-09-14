"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LaunchSummary } from "@/lib/types";
import Image from "next/image";

type Sort = "TRENDING" | "NEW" | "MOST REWARDED" | "MOST VOLUME";
const money = (value: number | null) => value === null ? "Pending" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact" }).format(value);

export function ExploreGrid() {
  const [launches, setLaunches] = useState<LaunchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [sort, setSort] = useState<Sort>("NEW");
  useEffect(() => { fetch("/api/launches").then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error("Launches could not be loaded. Please refresh to retry."); return body; }).then((body) => { setLaunches(body.launches ?? []); setConfigured(body.configured !== false); }).catch((caught) => setError(caught.message)).finally(() => setLoading(false)); }, []);
  const sorted = useMemo(() => [...launches].sort((a, b) => {
    if (sort === "NEW") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "MOST REWARDED") return BigInt(b.totalRewardedAtoms) === BigInt(a.totalRewardedAtoms) ? 0 : BigInt(b.totalRewardedAtoms) > BigInt(a.totalRewardedAtoms) ? 1 : -1;
    if (sort === "MOST VOLUME") return (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1);
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }), [launches, sort]);
  if (loading) return <div className="empty" role="status">Loading launches…</div>;
  if (error) return <div className="error" role="alert">{error}</div>;
  return <><div className="tabs">{(["TRENDING","NEW","MOST REWARDED","MOST VOLUME"] as Sort[]).map((item) => <button key={item} disabled={item === "TRENDING"} title={item === "TRENDING" ? "Enabled after sufficient verified market history" : undefined} className={sort === item ? "active" : ""} onClick={() => setSort(item)}>{item}{item === "TRENDING" ? " · SOON" : ""}</button>)}</div>{sorted.length ? <div className="cards">{sorted.map((launch) => <Link href={`/token/${launch.mint}`} className="token-card" key={launch.id}><div className="token-card-head"><div className="token-identity">{launch.imageUrl && <Image unoptimized width={52} height={52} src={launch.imageUrl} alt="" />}<div><h3>{launch.name}</h3><span className="ticker">${launch.symbol}</span></div></div><span className="status-pill">{launch.trackerStatus === "active" ? "TRACKED" : "ACTION NEEDED"}</span></div><div className="metrics"><div className="metric"><span>Pair</span><strong>{launch.symbol} / {launch.quoteSymbol}</strong></div><div className="metric"><span>Market cap</span><strong>{money(launch.marketCapUsd)}</strong></div><div className="metric"><span>24h volume</span><strong>{money(launch.volume24hUsd)}</strong></div><div className="metric"><span>Total rewards</span><strong>{launch.totalRewardedAtoms} atoms</strong></div><div className="metric"><span>Eligible</span><strong>{launch.eligibleWallets}</strong></div><div className="metric"><span>Age</span><strong>{Math.max(0, Math.floor((Date.now() - Date.parse(launch.createdAt)) / 86_400_000))}d</strong></div></div></Link>)}</div> : <div className="empty">{configured ? "No completed TopBlast launches yet." : "Launch registration is not active yet. Verified launches will appear here once the platform opens."}</div>}</>;
}
