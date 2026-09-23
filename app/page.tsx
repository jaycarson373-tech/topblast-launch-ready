import Link from "next/link";
import Image from "next/image";
import { BlastExample } from "@/components/blast-example";
import { LaunchActions, VenueCards } from "@/components/platform-state";

export default function Home() {
  return <main>
    <section className="hero shell">
      <div className="eyebrow">REWARD INFRASTRUCTURE FOR TOKEN LAUNCHES</div>
      <div className="hero-grid"><div>
        <Image className="hero-mark" src="/logo-mark.png" alt="TopBlast Launch" width={82} height={82} priority />
        <h1 className="platform-headline">LAUNCH<br />UNDERNEATH.<br /><span>REWARDS<br />ON TOP.</span></h1>
        <p className="hero-copy">Launch through StonkFun or Pump.fun. Verified venue fees fund an isolated reward pool. Holders below entry can share each epoch.</p>
        <LaunchActions /><p className="proof-line">No funded pool. No reward.</p>
      </div><BlastExample /></div>
    </section>
    <section className="three-steps shell" aria-label="How TopBlast works">
      <article><span>01 / LAUNCH</span><h3>The venue creates.</h3><p>Create through StonkFun or Pump.fun.</p></article>
      <article><span>02 / FUND</span><h3>Verified fees fund.</h3><p>Each attributable fee receipt funds only its launch.</p></article>
      <article><span>03 / BLAST</span><h3>Eligible holders share.</h3><p>Eligible holders below entry share the funded rewards.</p></article>
    </section>
    <section className="funding-truth"><div className="shell"><strong>Verified fees in. Direct holder airdrops out.</strong><p>Stonk creator-fee forwards are matched to the exact launch before funding its isolated pool. Pump remains beta until creator-wide fees can be attributed safely.</p></div></section>
    <section className="shell how"><div><div className="eyebrow">BOUGHT IN. PRICE DROPPED. STILL HOLDING?</div><h2>YOUR ENTRY<br />SETS THE LINE.</h2><p className="hero-copy">TopBlast rewards participation. It does not promise to recover losses.</p></div>
      <div className="blast-diagram"><div><span>YOUR VERIFIED ENTRY</span><b /></div><p>Current price below</p><div className="blast-zone">BLAST ZONE</div><small>A verified market buy. Retained eligible tokens. No sell or outgoing transfer in the epoch. A finalized snapshot. A funded pool. Every condition matters.</small><Link href="/docs#eligibility" className="text-link">Read the eligibility rules →</Link></div>
    </section>
    <VenueCards />
    <section className="shell funding-explainer"><div className="eyebrow">AUTOMATIC ROUTING · FIXED SPLIT</div><h2>FEES IN.<br />AIRDROPS OUT.</h2><p>Creators divide 100% of their 90% share between holder rewards and creator distributions. TopBlast’s protocol allocation is fixed at 10% of verified gross funding and designated for TOPBLAST buybacks and burns.</p><div className="allocation-example"><div><strong>72%</strong><span>Holder rewards</span></div><div><strong>18%</strong><span>Creator distribution</span></div><div><strong>10%</strong><span>TOPBLAST buyback + burn</span></div></div><p>Example: an 80% rewards / 20% creator selection. Each verified 100-unit Stonk fee receipt credits 72 units to rewards, prepares 18 for the creator, and accounts for 10 as protocol treasury funds designated for TOPBLAST buybacks and burns. An amount counts as burned only after its transaction is confirmed and published.</p><Link className="button button-secondary" href="/launch">Review launch setup</Link></section>
    <section className="shell journey-pair"><article><div className="eyebrow">FOR CREATORS</div><h3>Launch. Trade. Verify.</h3><p>Choose your venue, pair and policy. Approve the exact launch transaction. Follow verified fee receipts, epochs and automatic distributions.</p><Link href="/creator" className="text-link">Open creator dashboard →</Link></article><article><div className="eyebrow">FOR HOLDERS</div><h3>Buy. Hold. Check.</h3><p>Your verified buys establish entry. Search your wallet on the token page. Reserved rewards are not paid until the transaction is confirmed.</p><Link href="/explore" className="text-link">Explore verified launches →</Link></article></section>
  </main>;
}
