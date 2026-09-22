"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { clientJson } from "@/lib/client-json";
import { VenueBadge } from "@/components/venue-badge";

interface Health { launchReady: boolean; rewardsReady: boolean; fundingReady?: boolean; rewardBlockers: string[]; controlledTesting?: boolean; venues: Record<string, { launchReady: boolean; pairReady: boolean; blockers: string[] }>; checks: { dryRun: boolean; enginePaused: boolean; workerFresh: boolean } }
interface State { health: Health | null; error: string; loading: boolean; retry: () => void }
const Context = createContext<State>({ health: null, error: "", loading: true, retry: () => {} });
export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setError(""); setHealth(null);
    clientJson("/api/health", { cache: "no-store" }, 12_000, "Availability check timed out")
      .then(({ response, body }) => { if ((!response.ok && response.status !== 503) || typeof body.launchReady !== "boolean" || !body.venues) throw new Error("Availability could not be verified"); if (current) setHealth(body); })
      .catch((caught) => { if (current) setError(caught.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [attempt]);
  return <Context.Provider value={{ health, error, loading, retry: () => setAttempt((value) => value + 1) }}>{children}</Context.Provider>;
}
export const usePlatformState = () => useContext(Context);
export function LaunchActions() {
  // Opening the form does not authorize creation. Server-side launch gates remain authoritative.
  return <div className="hero-actions"><Link className="button" href="/launch">Launch token</Link><Link className="button button-secondary" href="/explore">Explore launches</Link></div>;
}
export function NavStatus() {
  const { health, loading, error } = usePlatformState();
  return <span className="nav-status" role="status">{loading ? "CHECKING" : error ? "CHECK FAILED" : health?.launchReady ? "AVAILABLE" : "LOCKED"}</span>;
}
export function VenueCards() {
  const { health, loading, error, retry } = usePlatformState();
  return <section className="shell venue-section"><div className="eyebrow">VENUES UNDERNEATH</div><h2>THEIR MARKETS.<br />YOUR REWARD LAYER.</h2><div className="venue-cards">{(["stonkfun", "pumpfun"] as const).map((venue) => {
    const state = health?.venues[venue];
    const status = loading ? "CHECKING" : error ? "CHECK FAILED" : !state?.pairReady ? "UNAVAILABLE" : venue === "pumpfun" ? "BETA" : state.launchReady ? "AVAILABLE" : "LOCKED";
    return <article className="panel" key={venue}><div className="venue-card-heading"><VenueBadge venue={venue} /><span className="status-pill">{status}</span></div><h3>{venue === "stonkfun" ? "ANY LIVE STONK PAIR" : "SOL / WSOL"}</h3><p>{venue === "stonkfun" ? "Selected quote asset rewards. Verified automatic creator-fee routing. Direct holder airdrops." : "SOL pair / WSOL rewards. Pump fee attribution remains beta."}</p>{venue === "pumpfun" ? <p>Official creation instruction only. No initial buy, native cashback, mayhem, or non-SOL pairs. PumpSwap graduation is unsupported; tracking and new epochs pause after graduation.</p> : <p>Launches use StonkFun’s existing LaunchLab infrastructure. Token creation and reward activation are separate checks.</p>}
      {state?.blockers?.length ? <details><summary>Current launch dependencies</summary><ul>{state.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details> : null}
      {error && <button onClick={retry} className="button button-secondary button-small">Retry check</button>}
    </article>;
  })}</div><p className="notice">Independent integration. Neither venue operates or endorses TopBlast. Beta does not mean the full production reward lifecycle has passed.</p></section>;
}
