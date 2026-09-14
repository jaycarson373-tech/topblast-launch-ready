"use client";
import { useEffect, useState } from "react";

export function ProofPage({ address }: { address: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch(`/api/token/${address}`).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); }).catch((caught) => setError(caught.message)); }, [address]);
  if (error) return <main className="page shell"><div className="error">{error}</div></main>;
  const epochs = (data?.epochs ?? []) as Record<string, unknown>[];
  const proofs = (data?.proofs ?? []) as Record<string, unknown>[];
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">ONCHAIN PROOF</div><h1>EPOCH<br /><span>HISTORY.</span></h1></div><p>Finalized snapshot blocks, funded budgets, distribution totals, and transaction signatures. Historical rows are append-only.</p></div>{epochs.length ? <div className="panel"><table className="proof-table"><thead><tr><th>Epoch</th><th>Snapshot block</th><th>Budget</th><th>Distributed</th><th>Status</th></tr></thead><tbody>{epochs.map((epoch) => <tr key={String(epoch.id)}><td>{String(epoch.sequence)}</td><td>{String(epoch.snapshot_slot ?? "Pending")}</td><td>{String(epoch.funded_budget_atoms)}</td><td>{String(epoch.distributed_atoms)}</td><td>{String(epoch.status)}</td></tr>)}</tbody></table></div> : <div className="empty">No completed reward epochs yet.</div>}{proofs.length>0&&<div className="panel" style={{marginTop:24}}><div className="section-label">Transaction proofs</div><table className="proof-table"><thead><tr><th>Kind</th><th>Slot</th><th>Signature</th></tr></thead><tbody>{proofs.map((proof,index)=><tr key={`${String(proof.signature)}-${index}`}><td>{String(proof.kind)}</td><td>{String(proof.slot??"Pending")}</td><td className="mono">{String(proof.signature??"Dry run")}</td></tr>)}</tbody></table></div>}</main>;
}
