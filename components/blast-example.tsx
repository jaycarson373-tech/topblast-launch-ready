"use client";
import { useState } from "react";

export function BlastExample() {
  const [price, setPrice] = useState(70);
  const [holding, setHolding] = useState(true);
  const below = price < 100;
  const qualifies = below && holding;
  const y = 168 - (price - 40) * 1.2;
  return <div className="example-card">
    <div className="example-heading"><span>HOW THE BLAST ZONE WORKS</span><span>ILLUSTRATION</span></div>
    <div className="example-prices"><div><small>Verified entry</small><strong>100 <em>STONK</em></strong></div><div><small>Current value</small><strong>{price} <em>STONK</em></strong></div></div>
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
    <div className={`example-result ${qualifies ? "in-zone" : ""}`} aria-live="polite"><strong>{qualifies ? "IN THE BLAST ZONE" : !holding ? "EXCLUDED THIS EPOCH" : "ABOVE THE BLAST ZONE"}</strong><p>{qualifies ? "This verified buyer could share a funded reward pool. The amount depends on eligible losses and available funds." : !holding ? "Selling or transferring out excludes this wallet for the current epoch." : "Rewards target eligible holders below their verified entry."}</p></div>
    <p className="example-note">Example only · No live prices or promised payouts</p>
  </div>;
}
