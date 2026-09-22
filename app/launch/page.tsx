import { LaunchForm } from "@/components/launch-form";
import { launchPageUsesTestMode } from "@/lib/launch-page-mode";

export const dynamic = "force-dynamic";

export default function LaunchPage() {
  const prelaunch = launchPageUsesTestMode();
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">CREATE LAUNCH</div><h1>BUILD THE REWARDS<br /><span>INTO THE LAUNCH.</span></h1></div><p>Choose StonkFun or Pump.fun. Launch through the venue, activate the isolated TopBlast ledger, and route verified reward funding into direct holder airdrops.</p></div><ol className="launch-steps"><li>Choose venue</li><li>Choose pair</li><li>Add token details</li><li>Set reward allocation</li><li>Review exact costs</li><li>Connect and launch</li></ol><LaunchForm testMode={prelaunch} publicTestListing={prelaunch && process.env.CONTROLLED_TEST_LISTINGS_PUBLIC === "true"} /></main>;
}
