import type { Metadata } from "next";
import { LaunchForm } from "@/components/launch-form";

export const metadata: Metadata = { title: "Controlled test launch | TopBlast", robots: { index: false, follow: false } };

export default function TestLaunchPage() {
  const publicTestListing = process.env.CONTROLLED_TEST_LISTINGS_PUBLIC === "true";
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">CONTROLLED MAINNET TEST</div><h1>REVIEW.<br /><span>TEST. VERIFY.</span></h1></div><p>Approved creator wallets only. No operator token or private key needed. {publicTestListing ? "New tests stay publicly listed with a controlled-test label." : "Hidden from TopBlast listings, public onchain and at the venue."} Real Solana mainnet costs apply. Token creation alone does not verify rewards.</p></div><LaunchForm testMode publicTestListing={publicTestListing} /></main>;
}
