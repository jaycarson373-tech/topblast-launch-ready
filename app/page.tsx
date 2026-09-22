import Link from "next/link";
import Image from "next/image";
import { PlatformStatus } from "@/components/platform-status";
import { BlastExample } from "@/components/blast-example";
import { LaunchActions, VenueCards } from "@/components/platform-state";

export default function Home() {
  return <main>
    <PlatformStatus />
    <section className="hero shell">
      <div className="eyebrow">REWARD INFRASTRUCTURE FOR TOKEN LAUNCHES</div>
      <div className="hero-grid"><div>
        <Image className="hero-mark" src="/logo-mark.svg" alt="TopBlast Launch" width={82} height={82} priority />
        <h1 className="platform-headline">LAUNCH<br />UNDERNEATH.<br /><span>REWARDS<br />ON TOP.</span></h1>
        <p className="hero-copy">Launch through StonkFun or Pump.fun. Fund an isolated reward pool. Verified holders below their entry can share each epoch.</p>
        <LaunchActions /><p className="proof-line">No funded pool. No reward.</p>
      </div><BlastExample /></div>
    </section>
    <section className="three-steps shell" aria-label="How TopBlast works">
      <article><span>01 / LAUNCH</span><h3>The venue creates.</h3><p>Create through StonkFun or Pump.fun.</p></article>
      <article><span>02 / FUND</span><h3>The creator funds.</h3><p>Deposit rewards into that launch’s isolated pool.</p></article>
      <article><span>03 / BLAST</span><h3>Eligible holders share.</h3><p>Eligible holders below entry share the funded rewards.</p></article>
    </section>
    <section className="funding-truth"><div className="shell"><strong>Venue fees do not automatically become rewards.</strong><p>Creators explicitly fund each launch’s isolated reward pool.</p></div></section>
    <section className="shell how"><div><div className="eyebrow">BOUGHT IN. PRICE DROPPED. STILL HOLDING?</div><h2>YOUR ENTRY<br />SETS THE LINE.</h2><p className="hero-copy">TopBlast rewards participation. It does not promise to recover losses.</p></div>
      <div className="blast-diagram"><div><span>YOUR VERIFIED ENTRY</span><b /></div><p>Current price below</p><div className="blast-zone">BLAST ZONE</div><small>A verified market buy. Retained eligible tokens. No sell or outgoing transfer in the epoch. A finalized snapshot. A funded pool. Every condition matters.</small><Link href="/docs#eligibility" className="text-link">Read the eligibility rules →</Link></div>
    </section>
    <VenueCards />
    <section className="shell funding-explainer"><div className="eyebrow">FUNDING, NOT A TRADING TAX</div><h2>ONE DEPOSIT.<br />A FIXED SPLIT.</h2><p>Creators divide 100% of their 90% share between holder rewards and retained creator funding. TopBlast’s protocol allocation is fixed at 10% of declared gross funding.</p><div className="allocation-example"><div><strong>72%</strong><span>Holder rewards</span></div><div><strong>18%</strong><span>Retained by creator</span></div><div><strong>10%</strong><span>Protocol</span></div></div><p>Example: an 80% rewards / 20% creator selection. On a declared 100-unit funding amount, 72 units fund rewards, 10 transfer to the protocol, and 18 stay with the creator. The launch review fixes the policy before signing.</p><Link className="button button-secondary" href="/launch">Review launch setup</Link></section>
    <section className="shell journey-pair"><article><div className="eyebrow">FOR CREATORS</div><h3>Launch. Fund. Verify.</h3><p>Choose your venue and policy. Approve the exact launch transaction. Fund your pool, then follow its epochs and receipts.</p><Link href="/creator" className="text-link">Open creator dashboard →</Link></article><article><div className="eyebrow">FOR HOLDERS</div><h3>Buy. Hold. Check.</h3><p>Your verified buys establish entry. Search your wallet on the token page. Reserved rewards are not paid until the transaction is confirmed.</p><Link href="/explore" className="text-link">Explore verified launches →</Link></article></section>
  </main>;
}
