import { LaunchForm } from "@/components/launch-form";
import { launchPageUsesTestMode } from "@/lib/launch-page-mode";
import TestLaunchPage from "@/app/launch/test/page";

export const dynamic = "force-dynamic";

export default function LaunchPage() {
  // The main CTA must not send testers into the separately locked public-launch flow.
  if (launchPageUsesTestMode()) return <TestLaunchPage />;
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">CREATE LAUNCH</div><h1>BUILD THE REWARDS<br /><span>INTO THE LAUNCH.</span></h1></div><p>Choose StonkFun or Pump.fun. Each launch has an isolated TopBlast reward ledger funded by explicit creator deposits. Live creation requires the selected venue’s readiness checks to pass.</p></div><LaunchForm /></main>;
}
