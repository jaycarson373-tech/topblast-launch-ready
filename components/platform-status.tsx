"use client";
import { useEffect, useState } from "react";

export function PlatformStatus() {
  const [state, setState] = useState<{ mode: "checking" | "preview" | "launches" | "operational" | "unavailable"; text?: string }>({ mode: "checking" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await response.json(); setState({ mode: body.rewardsReady === true ? "operational" : body.launchReady === true ? "launches" : "preview", text: body.rewardStatus }); })
      .catch(() => { if (!controller.signal.aborted) setState({ mode: "unavailable" }); });
    return () => controller.abort();
  }, []);
  return <div className="platform-status" role="status"><div className="shell">
    <strong>{state.mode === "checking" ? "Checking availability" : state.mode === "unavailable" ? "Status unavailable" : state.mode === "operational" ? "Reward engine operational" : state.mode === "launches" ? "Controlled launch testing" : "Configuration required"}</strong>
    <span>{state.mode === "checking" ? "Verifying launch services…" : state.mode === "unavailable" ? "Launch availability could not be verified. Please try again shortly." : state.mode === "operational" ? "Finalized tracking, funding, epochs, and wallet-approved payouts are available." : state.mode === "preview" ? "Live launches are locked. Try the free simulation at Test now. No funds or wallet required." : "Controlled launches are available. A real end-to-end payout proof is still required before production claims."}</span>
  </div></div>;
}
