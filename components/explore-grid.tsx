"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LaunchSummary } from "@/lib/types";
import Image from "next/image";
import { clientJson } from "@/lib/client-json";
import { formatTokenAtoms } from "@/lib/token-display";
import { VenueBadge } from "@/components/venue-badge";
import { orderFeaturedLaunches } from "@/lib/explore-order";

type Sort = "FEATURED" | "TRENDING" | "NEW" | "MOST REWARDED" | "MOST VOLUME";
const money = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact" }).format(value);

export function ExploreGrid({ featuredMints = [] }: { featuredMints?: string[] }) {
  const [launches, setLaunches] = useState<LaunchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [sort, setSort] = useState<Sort>(featuredMints.length ? "FEATURED" : "NEW");
  const [attempt, setAttempt] = useState(0);
  const mixedRewardAssets = new Set(launches.map((launch) => launch.quoteSymbol)).size > 1;
  useEffect(() => {
    let current = true; setLoading(true); setError("");
    clientJson("/api/launches", { cache: "no-store" }, 15_000, "Launches could not be loaded in time. Retry below.")
      .then(({ response, body }) => { if (!response.ok) throw new Error("Launches are temporarily unavailable. No empty-market assumption has been made."); if (current) { setLaunches(body.launches ?? []); setConfigured(body.configured !== false); } })
      .catch((caught) => { if (current) setError(caught.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [attempt]);
  const sorted = useMemo(() => sort === "FEATURED" ? orderFeaturedLaunches(launches, featuredMints) : [...launches].sort((a, b) => {
    if (sort === "NEW") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "MOST REWARDED") return BigInt(b.totalRewardedAtoms) === BigInt(a.totalRewardedAtoms) ? 0 : BigInt(b.totalRewardedAtoms) > BigInt(a.totalRewardedAtoms) ? 1 : -1;
    if (sort === "MOST VOLUME") return (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1);
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }), [launches, sort, featuredMints]);
  if (loading) return <div className="empty" role="status">Loading launches…</div>;
  if (error) return <div className="error" role="alert">{error}<br /><button className="button button-secondary" onClick={() => setAttempt(attempt + 1)}>Retry launches</button></div>;
  return <><div className="tabs">{([...(featuredMints.length ? ["FEATURED"] : []),"TRENDING","NEW","MOST REWARDED","MOST VOLUME"] as Sort[]).map((item) => <button key={item} disabled={item === "TRENDING" || (item === "MOST REWARDED" && mixedRewardAssets)} title={item === "TRENDING" ? "Enabled after sufficient verified market history" : item === "MOST REWARDED" && mixedRewardAssets ? "Different reward assets cannot be ranked by raw units" : undefined} className={sort === item ? "active" : ""} onClick={() => setSort(item)}>{item}{item === "TRENDING" ? " · SOON" : ""}</button>)}</div>{sorted.length ? <div className="cards">{sorted.map((launch) => <Link href={`/token/${launch.mint}`} className="token-card" key={launch.id}><div className="token-card-head"><div className="token-identity">{launch.imageUrl && <Image unoptimized width={52} height={52} src={launch.imageUrl} alt="" />}<div><h3>{launch.name}</h3><span className="ticker">${launch.symbol}</span></div></div><span className="status-pill">{launch.trackerStatus === "active" ? "TRACKED" : "ACTION NEEDED"}</span></div><div className="venue-row"><VenueBadge venue={launch.venue ?? "stonkfun"} />{launch.isTest && <span className="status-pill">VERIFICATION LAUNCH</span>}</div><div className="metrics"><div className="metric"><span>Pair</span><strong>{launch.symbol} / {launch.quoteSymbol}</strong></div><div className="metric"><span>Market cap</span><strong>{money(launch.marketCapUsd)}</strong></div><div className="metric"><span>24h volume</span><strong>{money(launch.volume24hUsd)}</strong></div><div className="metric"><span>Confirmed rewards paid</span><strong>{launch.quoteDecimals == null ? `${launch.totalRewardedAtoms} atoms` : formatTokenAtoms(launch.totalRewardedAtoms, launch.quoteDecimals)} {launch.quoteSymbol === "SOL" ? "WSOL" : launch.quoteSymbol}</strong></div><div className="metric"><span>Eligible</span><strong>{launch.eligibleWallets}</strong></div><div className="metric"><span>Funded rewards available</span><strong>{launch.availableRewardAtoms == null ? "No funded balance" : launch.quoteDecimals == null ? `${launch.availableRewardAtoms} atoms` : formatTokenAtoms(launch.availableRewardAtoms, launch.quoteDecimals)}</strong></div><div className="metric"><span>Current epoch</span><strong>{launch.currentEpoch ?? "Not started"}</strong></div></div><span className="text-link">Open token, eligibility & proof →</span></Link>)}</div> : <div className="empty"><h3>{configured ? "NO PUBLIC TOPBLAST LAUNCHES YET" : "LAUNCH DATA UNAVAILABLE"}</h3><p>{configured ? "Be the first to launch with TopBlast." : "Launch registration is not configured. This is not evidence that no launches exist."}</p><div className="hero-actions"><Link href="/launch" className="button">Launch token</Link><Link href="/docs" className="button button-secondary">How it works</Link></div></div>}</>;
}
