import type { Metadata } from "next";
import { LaunchForm } from "@/components/launch-form";

export const metadata: Metadata = { title: "Controlled test launch | TopBlast", robots: { index: false, follow: false } };

export default function TestLaunchPage() {
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">WALLET-CONNECTED TEST LAUNCH</div><h1>CONNECT.<br /><span>TEST LAUNCH.</span></h1></div><p>Connect your wallet, choose StonkFun or Pump.fun, and review before signing. No operator token needed when testing is open. Hidden from TopBlast listings, public onchain and at the venue. Real Solana mainnet costs apply.</p></div><LaunchForm testMode /></main>;
}
