import { LaunchForm } from "@/components/launch-form";
import { launchPageUsesTestMode } from "@/lib/launch-page-mode";
import TestLaunchPage from "@/app/launch/test/page";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LaunchPage() {
  // The main CTA must not send testers into the separately locked public-launch flow.
  if (launchPageUsesTestMode()) return <TestLaunchPage />;
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">CREATE LAUNCH</div><h1>BUILD THE REWARDS<br /><span>INTO THE LAUNCH.</span></h1></div><p>Choose StonkFun or Pump.fun. Each launch has an isolated TopBlast reward ledger funded by explicit creator deposits. Live creation requires the selected venue’s readiness checks to pass.</p></div>{process.env.CONTROLLED_LAUNCH_WALLETS && process.env.LAUNCHES_ENABLED !== "true" && <aside className="docs-callout"><strong>Public launches are closed pending reward acceptance.</strong><p>Approved test creator? <Link href="/launch/test">Open the controlled mainnet test</Link>. No real funds needed? <Link href="/test">Use the simulation</Link>.</p></aside>}<ol className="launch-steps"><li>Choose venue</li><li>Add token details</li><li>Set reward allocation</li><li>Review treasuries and costs</li><li>Connect and approve</li><li>Keep receipt, then fund</li></ol><LaunchForm /></main>;
}
