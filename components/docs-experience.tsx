"use client";

import Link from "next/link";
import { useState } from "react";
import { newRehearsal, rehearsalAmount, rehearsalPlan, type RehearsalState } from "@/lib/testing/rehearsal";

const journeys = {
  creator: [
    { label: "Configure", title: "Your token. Your allocation.", text: "Choose StonkFun or Pump.fun, add your token details, and set the fixed allocation. The venue handles creation and trading infrastructure.", link: "#venues", cta: "Compare the venues" },
    { label: "Review & sign", title: "Know what you’re approving.", text: "Read the network, fee payer, recipient or program, and amount. Approve in your wallet. A timeout means check your existing receipt, not pay again.", link: "#launch", cta: "Understand launch recovery" },
    { label: "Fund", title: "Put a real budget behind it.", text: "Use the creator dashboard’s funding action. Only the finalized, attributable reward portion becomes this launch’s budget. Venue fees do not flow here automatically.", link: "#funding", cta: "Follow the funding" },
    { label: "Verify", title: "The receipt is the result.", text: "Tracking, eligibility, and allocation come before payment. The treasury wallet approves payouts. Check confirmed transaction links, not just allocated totals.", link: "#proof", cta: "Learn to read the proof" },
  ],
  holder: [
    { label: "Buy", title: "A verified buy draws the line.", text: "Recognized market buys establish your weighted average entry. Tokens received by transfer do not create a purchase price.", link: "#eligibility", cta: "See the entry rules" },
    { label: "Keep holding", title: "Below entry. Still in position.", text: "A retained verified position below entry may qualify. Selling or sending tokens out excludes your wallet for that epoch. Eligibility still depends on complete history and a valid snapshot.", link: "#lab", cta: "Try the eligibility lab" },
    { label: "Check funding", title: "An empty pool pays nothing.", text: "Eligible holders share only that launch’s funded budget. Loss weighting determines the allocation. There is no guaranteed return or promise to make losses whole.", link: "#funding", cta: "Understand the reward pool" },
    { label: "Check proof", title: "Allocated isn’t in your wallet yet.", text: "Look up your wallet on the token page. Follow its epoch proof to distinguish a calculated allocation, a submitted transaction, and a confirmed payment.", link: "#proof", cta: "Check what paid means" },
  ],
} as const;

export function DocsJourney() {
  const [role, setRole] = useState<keyof typeof journeys>("creator");
  const [step, setStep] = useState(0);
  const selected = journeys[role][step];
  return <section className="docs-journey" aria-label="Interactive product walkthrough">
    <div className="docs-journey-top"><div><span className="eyebrow">PICK YOUR SIDE OF THE LAUNCH</span><h2>Take the short route.</h2></div><div className="docs-switch" role="group" aria-label="Choose your journey">
      <button aria-pressed={role === "creator"} onClick={() => { setRole("creator"); setStep(0); }}>I’m launching</button>
      <button aria-pressed={role === "holder"} onClick={() => { setRole("holder"); setStep(0); }}>I’m holding</button>
    </div></div>
    <div className="docs-journey-track" role="group" aria-label="Explore a walkthrough step">{journeys[role].map((item, index) => <button key={item.label} aria-pressed={step === index} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, "0")}</span>{item.label}</button>)}</div>
    <div className="docs-journey-detail" aria-live="polite"><span className="docs-step-number" aria-hidden="true">0{step + 1}</span><div><h3>{selected.title}</h3><p>{selected.text}</p><Link href={selected.link}>{selected.cta} <span aria-hidden="true">↗</span></Link></div></div>
    <p className="docs-walkthrough-note">Explore a step. This is a walkthrough, not live launch progress.</p>
  </section>;
}

const scenarios = [
  { id: "holding", label: "Still holding" },
  { id: "incoming_transfer", label: "Receive 5 tokens" },
  { id: "sell", label: "Sell 5 tokens" },
  { id: "outgoing_transfer", label: "Send 5 tokens" },
  { id: "transfer_only", label: "Never bought" },
] as const;
type Scenario = typeof scenarios[number]["id"];

export function DocsEligibilityLab() {
  const [price, setPrice] = useState(5);
  const [scenario, setScenario] = useState<Scenario>("holding");
  const [funded, setFunded] = useState(true);
  const transferOnly = scenario === "transfer_only";
  const state: RehearsalState = { ...newRehearsal(), step: 3, price, gross: funded ? 100 : 0, movement: transferOnly ? "holding" : scenario };
  const plan = rehearsalPlan(state);
  const wallet = transferOnly ? "Transfer-only wallet" : "Holder A";
  const snapshot = plan.snapshots.find((item) => item.wallet === wallet)!;
  const allocation = plan.allocations.find((item) => item.wallet === wallet)?.amountQuoteAtoms ?? 0n;
  const eligible = snapshot.status === "ELIGIBLE";
  const explanations: Record<Scenario, string> = {
    holding: "Both buys establish entry. The 20 retained verified units can qualify when the snapshot price is below 15.",
    incoming_transfer: "The extra 5 tokens add no purchased basis. Verified entry stays 15, with 20 verified units, not 25.",
    sell: "Selling excludes this wallet for the sample epoch, even if some tokens remain below entry.",
    outgoing_transfer: "Sending tokens out excludes this wallet for the sample epoch. Moving tokens does not preserve eligibility.",
    transfer_only: "This wallet received 20 tokens but never bought through the recognized market. No verified entry means no eligible purchased position.",
  };
  const y = 200 - price * 6;
  return <div className="docs-lab" role="region" aria-label="Illustrative eligibility lab">
    <div className="docs-lab-label"><strong>THE BLAST LAB</strong><span>SIMULATION ONLY · NO REAL PAYMENTS</span></div>
    <p className="docs-lab-intro">One wallet buys 10 tokens at 10 STONK, then 10 at 20. Its weighted entry is 15. Change what happens next.</p>
    <div className="docs-lab-scenarios" role="group" aria-label="Choose sample wallet activity">{scenarios.map((item) => <button key={item.id} aria-pressed={scenario === item.id} onClick={() => setScenario(item.id)}>{item.label}</button>)}</div>
    <div className="docs-lab-chart">
      {transferOnly ? <div className="docs-no-entry"><span>NO VERIFIED BUY</span><strong>No entry.<br />No blast line.</strong><p>Receiving tokens is not the same as buying them.</p></div> : <svg viewBox="0 0 560 230" role="img" aria-label={`Sample average entry 15 STONK per token; sample price ${price} STONK per token. Not a live chart.`}>
        <rect x="0" y="110" width="560" height="120" fill="#ff5a1f" fillOpacity=".12" />
        <path d="M0 50H560M0 170H560" stroke="#484239" />
        <path d="M0 110H560" stroke="#ffc928" strokeDasharray="6 6" />
        <text x="12" y="98" fill="#ffc928" fontSize="12">VERIFIED ENTRY: 15 STONK / TOKEN</text>
        <text x="12" y="216" fill="#ff9972" fontSize="11">BELOW ENTRY · THE BLAST ZONE</text>
        <path d={`M330 110L430 ${Math.max(20, y - 12)}L534 ${y}`} stroke="#ff7946" strokeWidth="4" fill="none" />
        <circle cx="534" cy={y} r="6" fill="#ffc928" />
      </svg>}
    </div>
    <label className="docs-lab-slider" htmlFor="docs-lab-price">Sample price <strong>{price} STONK / token</strong></label>
    <input id="docs-lab-price" type="range" min="1" max="30" value={price} onChange={(event) => setPrice(Number(event.target.value))} />
    <label className="docs-lab-funding"><input type="checkbox" checked={funded} onChange={(event) => setFunded(event.target.checked)} />Include a fictional 70 STONK reward pool</label>
    <div className="docs-lab-result" role="status"><div><span>THIS SAMPLE WALLET</span><strong>{eligible ? funded ? "ELIGIBLE · FUNDED EXAMPLE" : "ELIGIBLE · NO FUNDING" : snapshot.status.replaceAll("_", " ")}</strong><p>{explanations[scenario]} {eligible && !funded ? "There is no funded budget, so its allocation is zero." : ""}</p></div><div className="docs-lab-allocation"><span>Sample allocation<br />(not paid)</span><strong>{rehearsalAmount(allocation)}</strong><small>fictional STONK</small></div></div>
    <p className="docs-lab-footnote">The existing TopBlast calculator is reused. Another sample buyer may share the pool. All wallets, prices, and funding here are fictional; no transactions or signatures are created.</p>
    <button className="docs-lab-reset" onClick={() => { setPrice(5); setScenario("holding"); setFunded(true); }}>Reset the example</button>
  </div>;
}
