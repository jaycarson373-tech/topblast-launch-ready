"use client";
import { useState } from "react";

export function BlastExample() {
  const [price, setPrice] = useState(70);
  const [holding, setHolding] = useState(true);
  const [verified, setVerified] = useState(true);
  const [funded, setFunded] = useState(true);
  const [finalized, setFinalized] = useState(false);
  const [stage, setStage] = useState("eligible");
  const below = price < 100;
  const qualifies = below && holding && verified && funded && finalized;
  const status = !verified ? "NOT A VERIFIED BUYER" : !holding ? "DISQUALIFIED THIS EPOCH" : !below ? "ABOVE ENTRY" : !funded ? "POOL NOT FUNDED" : !finalized ? "SNAPSHOT PENDING" : stage === "paid" ? "PAYOUT CONFIRMED" : stage === "reserved" ? "REWARD RESERVED" : "ELIGIBLE";
  const y = 168 - (price - 40) * 1.2;
  return <div className="example-card">
    <div className="example-heading"><span>YOUR ENTRY SETS THE LINE</span><span>EXAMPLE ONLY</span></div>
    <div className="example-prices"><div><small>Verified entry</small><strong>{verified ? "100" : "None"} <em>{verified ? "STONK" : "NO BUY BASIS"}</em></strong></div><div><small>Current value</small><strong>{price} <em>STONK</em></strong></div></div>
    <svg viewBox="0 0 400 200" role="img" aria-label={`Illustrative entry of 100 STONK, current value ${price} STONK. ${below ? "Below" : "At or above"} entry.`}>
      <rect x="0" y="96" width="400" height="104" fill="rgba(255,90,31,.13)" />
      <path d="M0 40H400M0 160H400" stroke="#454039" />
      <path d="M0 96H400" stroke="#ffc928" strokeDasharray="5 5" />
      <text x="8" y="87" fill="#ffc928" fontSize="10">YOUR ENTRY</text>
      <path d={`M0 112L40 80L80 88L120 53L160 72L200 66L240 113L280 102L330 ${y + 7}L386 ${y}`} stroke="#ff6c36" strokeWidth="3" fill="none" />
      <circle cx="386" cy={y} r="5" fill="#ffc928" />
    </svg>
    <label className="example-slider" htmlFor="example-price">Move the price <span>{price - 100 > 0 ? "+" : ""}{price - 100}%</span></label>
    <input id="example-price" aria-label="Example current value" type="range" min="40" max="140" value={price} onChange={(event) => setPrice(Number(event.target.value))} />
    <label className="example-holding"><input type="checkbox" checked={holding} onChange={(event) => setHolding(event.target.checked)} />Still holding; no sells or outgoing transfers this epoch</label>
    <label className="example-holding"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />Verified market buy, not just received tokens</label>
    <label className="example-holding"><input type="checkbox" checked={funded} onChange={(event) => setFunded(event.target.checked)} />Launch reward pool is funded</label>
    <label className="example-holding"><input type="checkbox" checked={finalized} onChange={(event) => setFinalized(event.target.checked)} />Snapshot is finalized</label>
    {qualifies && <label className="example-stage">Illustrative reward stage<select value={stage} onChange={(event) => setStage(event.target.value)}><option value="eligible">Eligibility checked</option><option value="reserved">Reward reserved, not paid</option><option value="paid">Payout finalized</option></select></label>}
    <div className={`example-result ${qualifies ? "in-zone" : ""}`} aria-live="polite"><small>{below && verified ? "IN THE BLAST ZONE" : "ENTRY CHECK"}</small><strong>{status}</strong><p>{!verified ? "Receiving tokens alone creates no purchased cost basis." : !holding ? "A sell or outgoing transfer excludes this wallet for the applicable epoch." : !funded ? "An eligible position cannot be paid from an unfunded pool." : !finalized ? "Below entry is not enough. A finalized snapshot must verify every condition." : stage === "reserved" ? "Calculated and reserved. No payment has been made in this example." : stage === "paid" && qualifies ? "This illustrates a finalized payment, not a real transaction." : "An eligible share depends on verified losses, available funding and configured caps."}</p></div>
    <p className="example-note">SIMULATION ONLY · NO FUNDS NEEDED · NOT DEVNET · NO REAL PAYMENTS</p>
  </div>;
}
