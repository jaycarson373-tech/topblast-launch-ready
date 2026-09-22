"use client";
import { useEffect, useState } from "react";
import { clientJson } from "@/lib/client-json";

export function PlatformStatus() {
  const [state, setState] = useState<{ mode: "checking" | "preview" | "launches" | "operational" | "unavailable"; text?: string }>({ mode: "checking" });
  useEffect(() => {
    let mounted = true;
    clientJson("/api/health", { cache: "no-store" }, 25_000, "Status check timed out")
      .then(({ response, body }) => {
        if (typeof body.launchReady !== "boolean" || typeof body.rewardsReady !== "boolean" || (!response.ok && response.status !== 503)) throw new Error("Status unavailable");
        if (mounted) setState({ mode: body.rewardsReady === true && body.launchReady === true ? "operational" : body.launchReady === true ? "launches" : "preview", text: body.rewardStatus });
      })
      .catch(() => { if (mounted) setState({ mode: "unavailable" }); });
    return () => { mounted = false; };
  }, []);
  return <div className="platform-status" role="status"><div className="shell">
    <strong>{state.mode === "checking" ? "Checking availability" : state.mode === "unavailable" ? "Status unavailable" : state.mode === "operational" ? "Reward engine operational" : state.mode === "launches" ? "Token launches available" : "Launches unavailable"}</strong>
    <span>{state.mode === "checking" ? "Verifying launch services…" : state.mode === "unavailable" ? "Launch availability could not be verified. Please try again shortly." : state.mode === "operational" ? "Finalized tracking, funding, epochs, and wallet-approved payouts are available." : state.mode === "preview" ? "Live creation is currently locked. Check launch availability before connecting your wallet." : "Create through a supported venue. Reward payouts are not active yet; funding and payout verification are still required."}</span>
  </div></div>;
}
