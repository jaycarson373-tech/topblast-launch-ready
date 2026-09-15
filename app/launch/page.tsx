import { LaunchForm } from "@/components/launch-form";
import Link from "next/link";

export default function LaunchPage() {
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">CREATE LAUNCH</div><h1>BUILD THE REWARDS<br /><span>INTO THE LAUNCH.</span></h1></div><p>Choose StonkFun or Pump.fun. Each launch has an isolated TopBlast reward ledger funded by explicit creator deposits. Live creation requires the selected venue’s readiness checks to pass.</p></div><p className="test-form-link">Want to try TopBlast without spending? <Link href="/test">Open the free reward rehearsal →</Link></p><LaunchForm /></main>;
}
