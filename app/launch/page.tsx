import { LaunchForm } from "@/components/launch-form";
import Link from "next/link";

export default function LaunchPage() {
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">CREATE LAUNCH</div><h1>BUILD THE REWARDS<br /><span>INTO THE LAUNCH.</span></h1></div><p>Launch through StonkFun, register the finalized market, then fund its isolated reward ledger with explicit creator deposits.</p></div><p className="test-form-link">Want to try TopBlast without spending? <Link href="/test">Open the free reward rehearsal →</Link></p><LaunchForm /></main>;
}
