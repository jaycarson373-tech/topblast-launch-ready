import Link from "next/link";
import Image from "next/image";
import { PlatformStatus } from "@/components/platform-status";
import { BlastExample } from "@/components/blast-example";

export default function Home() {
  return (
    <main>
      <PlatformStatus />
      <section className="hero shell">
        <div className="eyebrow">THE LAUNCHPAD LAYER FOR TOP BLASTERS</div>
        <div className="hero-grid">
          <div>
            <Image className="hero-mark" src="/topblast-mark.png" alt="TopBlast" width={92} height={92} priority />
            <h1>LAUNCH WITH<br /><span>TOPBLAST.</span></h1>
            <p className="hero-copy">Bought in. Price dropped. Still holding? TopBlast is designed to share funded rewards with verified buyers below their entry.</p>
            <div className="hero-actions">
              <Link className="button" href="/launch">Launch token</Link>
              <Link className="button button-secondary" href="/explore">Explore launches</Link>
            </div>
            <p className="microcopy">StonkFun or Pump.fun. Your launch, with TopBlast on top.</p>
          </div>
          <BlastExample />
        </div>
      </section>
      <section className="positioning">
        <div className="shell position-grid">
          <div><span>STONKFUN + PUMP.FUN</span><strong>Launch + liquidity infrastructure.</strong></div>
          <div><span>OUR PLATFORM</span><strong>TopBlast reward infrastructure.</strong></div>
          <div><span>CREATOR</span><strong>Sets the reward allocation.</strong></div>
          <div><span>HOLDER</span><strong>Must qualify at each snapshot.</strong></div>
        </div>
      </section>
      <section className="shell how">
        <div><div className="eyebrow">THE RULE</div><h2>YOUR ENTRY<br />SETS THE LINE.</h2></div>
        <div className="blast-diagram">
          <div><span>YOUR VERIFIED ENTRY</span><b /></div>
          <p>Current price below</p>
          <div className="blast-zone">BLAST ZONE</div>
          <small>Verified buy + below entry + still holding. Sells and outgoing transfers exclude you for that epoch. Rewards depend on a funded pool.</small>
        </div>
      </section>
      <section className="shell funding-explainer">
        <div className="eyebrow">WHERE REWARDS COME FROM</div>
        <h2>FUNDED FIRST.<br />REWARDED SECOND.</h2>
        <p>Creators choose how deposited creator-fee revenue is allocated. A 70 / 20 / 10 setting means 70% for holder rewards, 20% for the creator, and 10% for the protocol.</p>
        <p>Creators receive or claim venue fees in their own wallet. The creator explicitly deposits the configured reward and protocol portions through a verified launch-scoped transaction. A percentage setting alone never counts as funding.</p>
        <Link className="button button-secondary" href="/launch">Review launch setup</Link>
      </section>
    </main>
  );
}
