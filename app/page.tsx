import Link from "next/link";

const flow = [
  ["01", "TOKEN LAUNCH", "Creator signs once"],
  ["02", "STONKFUN", "Launch and liquidity"],
  ["03", "TRADING FEES", "Verified onchain"],
  ["04", "TOPBLAST ENGINE", "Loss-weighted epochs"],
  ["05", "UNDERWATER HOLDERS", "Funded rewards only"],
];

export default function Home() {
  return (
    <main>
      <section className="hero shell">
        <div className="eyebrow">THE LAUNCHPAD LAYER FOR TOP BLASTERS</div>
        <div className="hero-grid">
          <div>
            <h1>LAUNCH WITH<br /><span>TOPBLAST.</span></h1>
            <p className="hero-copy">Launch on StonkFun with the TopBlast reward engine built in.</p>
            <div className="hero-actions">
              <Link className="button" href="/launch">Launch token</Link>
              <Link className="button button-secondary" href="/explore">Explore launches</Link>
            </div>
            <p className="microcopy">Your token. StonkFun underneath. TopBlast on top.</p>
          </div>
          <div className="flow-card" aria-label="Product flow">
            {flow.map(([number, label, detail], index) => (
              <div className="flow-row" key={number}>
                <span className="flow-number">{number}</span>
                <strong>{label}</strong>
                <span>{detail}</span>
                {index < flow.length - 1 && <i>↓</i>}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="positioning">
        <div className="shell position-grid">
          <div><span>STONKFUN</span><strong>Launch + liquidity infrastructure.</strong></div>
          <div><span>OUR PLATFORM</span><strong>TopBlast reward infrastructure.</strong></div>
          <div><span>CREATOR</span><strong>Chooses configuration.</strong></div>
          <div><span>HOLDER</span><strong>Gets rewards when eligible.</strong></div>
        </div>
      </section>
      <section className="shell how">
        <div><div className="eyebrow">THE RULE</div><h2>YOUR ENTRY<br />SETS THE LINE.</h2></div>
        <div className="blast-diagram">
          <div><span>YOUR VERIFIED ENTRY</span><b /></div>
          <p>Current price below</p>
          <div className="blast-zone">BLAST ZONE</div>
          <small>Below your verified entry. Still holding. Eligible for funded TopBlast rewards.</small>
        </div>
      </section>
    </main>
  );
}
