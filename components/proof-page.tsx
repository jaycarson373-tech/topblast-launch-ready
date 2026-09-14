"use client";
import { useEffect, useState } from "react";

const explorer = (signature: unknown) => `https://solscan.io/tx/${signature}`;
export function ProofPage({ address }: { address: string }) {
  const [data, setData] = useState<{ epochs: Record<string, unknown>[]; proofs: Record<string, unknown>[]; allocations: Record<string, unknown>[]; batches: Record<string, unknown>[]; deposits: Record<string, unknown>[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch(`/api/token/${address}`, { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); }).catch((caught) => setError(caught.message)); }, [address]);
  if (error) return <main className="page shell"><div className="error">{error}</div></main>;
  if (!data) return <main className="page shell"><div className="empty">Loading finalized proof...</div></main>;
  const epochs = data.epochs as Record<string, unknown>[];
  const proofs = data.proofs as Record<string, unknown>[];
  const allocations = data.allocations as Record<string, unknown>[];
  const batches = data.batches as Record<string, unknown>[];
  const deposits = data.deposits as Record<string, unknown>[];
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">ONCHAIN PROOF</div><h1>EPOCH<br /><span>HISTORY.</span></h1></div><p>Allocated means calculated and reserved. Paid means the payout transaction reached finalized confirmation. The two are never presented as the same state.</p></div>
    {epochs.length ? <div className="proof-stack">{epochs.map((epoch) => {
      const epochAllocations = allocations.filter((item) => item.epoch_id === epoch.id);
      const batch = batches.find((item) => item.epoch_id === epoch.id);
      const batchSignature = batch?.signature ? String(batch.signature) : null;
      return <section className="panel" key={String(epoch.id)}><div className="proof-epoch-head"><div><div className="section-label">Epoch {String(epoch.sequence)}</div><h3>{String(epoch.status).toUpperCase()}</h3></div><div><span>Snapshot slot</span><strong>{String(epoch.snapshot_slot ?? "Pending")}</strong></div><div><span>Eligible wallets</span><strong>{epochAllocations.length}</strong></div></div><div className="stats-grid"><div className="metric"><span>Funded budget</span><strong>{String(epoch.funded_budget_atoms)} atoms</strong></div><div className="metric"><span>Allocated</span><strong>{epochAllocations.reduce((sum, item) => sum + BigInt(String(item.amount_atoms)), 0n).toString()} atoms</strong></div><div className="metric"><span>Paid</span><strong>{String(epoch.distributed_atoms)} atoms</strong></div><div className="metric"><span>Payout state</span><strong>{String(batch?.status ?? "Not prepared")}</strong></div></div>{batchSignature && <a className="proof-link" href={explorer(batchSignature)} target="_blank" rel="noreferrer">View payout transaction {batchSignature}</a>}<details><summary>Wallet allocations</summary><div className="allocation-list">{epochAllocations.length ? epochAllocations.map((item) => <div key={String(item.wallet)}><span className="mono">{String(item.wallet)}</span><strong>{String(item.amount_atoms)} atoms · {batch?.status === "confirmed" ? "PAID" : "ALLOCATED"}</strong></div>) : <p>No payable wallets in this epoch.</p>}</div></details></section>;
    })}</div> : <div className="empty">No reward epochs have been created yet.</div>}
    {deposits.length > 0 && <section className="panel proof-section"><div className="section-label">Attributable funding</div>{deposits.map((deposit) => <a className="proof-link" key={String(deposit.signature)} href={explorer(deposit.signature)} target="_blank" rel="noreferrer">{String(deposit.amount_atoms)} atoms · slot {String(deposit.slot)} · {String(deposit.signature)}</a>)}</section>}
    {proofs.length > 0 && <section className="panel proof-section"><div className="section-label">Append-only transaction proofs</div>{proofs.map((proof, index) => proof.signature ? <a className="proof-link" key={`${proof.signature}-${index}`} href={explorer(proof.signature)} target="_blank" rel="noreferrer">{String(proof.kind)} · slot {String(proof.slot)} · {String(proof.signature)}</a> : <div className="proof-link" key={`${proof.kind}-${index}`}>{String(proof.kind)} · snapshot slot {String(proof.slot)}</div>)}</section>}
  </main>;
}
