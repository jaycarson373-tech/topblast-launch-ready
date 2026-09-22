"use client";
import Link from "next/link";
import { usePlatformState } from "@/components/platform-state";

export function PlatformStatus() {
  const { health, loading, error, retry } = usePlatformState();
  return <div className="platform-status" role="status"><div className="shell">
    <strong>{loading ? "Checking platform · 12s maximum" : error ? "CHECK FAILED" : health?.rewardsReady ? "REWARDS OPERATIONAL" : health?.launchReady ? "LAUNCHES AVAILABLE · REWARDS NOT ACTIVATED" : health?.controlledTesting ? "CONTROLLED TESTING" : "PUBLIC LAUNCHES UNAVAILABLE"}</strong>
    <span>{loading ? "Verifying venue and infrastructure dependencies." : error ? error : health?.rewardsReady ? "Finalized tracking and wallet-approved payouts are available." : "The complete funded reward cycle has not been accepted. No live payout guarantee."}</span>
    {error ? <button className="status-retry" onClick={retry}>Retry check</button> : !health?.launchReady && !loading ? <Link href="/test">Try the simulation →</Link> : null}
  </div></div>;
}
