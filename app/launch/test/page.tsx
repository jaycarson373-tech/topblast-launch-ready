import type { Metadata } from "next";
import { LaunchForm } from "@/components/launch-form";

export const metadata: Metadata = { title: "Controlled test launch | TopBlast", robots: { index: false, follow: false } };

export default function TestLaunchPage() {
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">OPERATOR ACCEPTANCE TEST</div><h1>TEST THE<br /><span>REAL LOOP.</span></h1></div><p>One test at a time. Hidden from Explore and public token/proof pages. Transactions and venue listings remain public on Solana mainnet. This is not a free simulation.</p></div><LaunchForm testMode /></main>;
}
