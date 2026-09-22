"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clientJson } from "@/lib/client-json";
import { allocationReceipt, type PublicAllocation, type PublicDistribution } from "@/lib/rewards/public-proof";

type Row = Record<string, unknown>;
interface ProofData { epochs: Row[]; proofs: Row[]; allocations: PublicAllocation[]; distributions: PublicDistribution[]; batches: Row[]; deposits: Row[]; snapshots?: Row[]; snapshotsUnavailable?: boolean; snapshotsLimited?: boolean }
const explorer = (signature: unknown) => `https://solscan.io/tx/${signature}`;
export function ProofPage({ address }: { address: string }) {
  const [data, setData] = useState<ProofData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setData(null); setError("");
    clientJson(`/api/token/${address}`, { cache: "no-store" }, 20_000, "Proof check timed out. No payment status has been inferred.")
      .then(({ response, body }) => { if (!response.ok) throw new Error(body.error ?? "Proof unavailable"); if (current) setData(body); })
      .catch((caught) => { if (current) setError(caught.message); });
    return () => { current = false; };
  }, [address, attempt]);
  if (error) return <main className="page shell"><div className="error" role="alert">{error}</div><button className="button" onClick={() => setAttempt(attempt + 1)}>Retry proof</button></main>;
  if (!data) return <main className="page shell"><div className="empty" role="status">Loading finalized proof…</div></main>;
  return <main className="page shell"><div className="page-header"><div><div className="eyebrow">ONCHAIN PROOF</div><h1>EPOCH<br /><span>HISTORY.</span></h1></div><p>Reserved is not paid. Only a verified, finalized transfer to the individual recipient counts as a confirmed payout.</p></div>
    <Link href={`/token/${address}`} className="text-link">Back to token</Link>
    {data.epochs.length ? <div className="proof-stack">{data.epochs.map((epoch) => {
      const allocations = data.allocations.filter((item) => item.epoch_id === epoch.id);
      const batches = data.batches.filter((item) => item.epoch_id === epoch.id);
      const snapshots = (data.snapshots ?? []).filter((item) => item.epoch_id === epoch.id);
      const allocated = allocations.reduce((sum, item) => sum + BigInt(item.amount_atoms), 0n);
      const paid = allocations.reduce((sum, item) => sum + BigInt(allocationReceipt(item, data.distributions ?? []).paidAtoms), 0n);
      return <section className="panel" key={String(epoch.id)}>
        <div className="proof-epoch-head"><div><div className="section-label">Epoch {String(epoch.sequence)}</div><h3>{String(epoch.status).toUpperCase()}</h3></div><div><span>Snapshot slot</span><strong>{String(epoch.snapshot_slot ?? "Pending")}</strong></div><div><span>Allocated wallets</span><strong>{allocations.length}</strong></div></div>
        <p>Snapshot cutoff: {String(epoch.end_time ?? "Pending")} · Price: {String(epoch.reference_price_quote_atoms ?? "Pending")} quote atoms per token</p>
        <p className="notice mono">Epoch ID: {String(epoch.id)} · Allocation hash: {String(epoch.allocation_hash ?? "Pending")}</p>
        <div className="stats-grid"><div className="metric"><span>Funded epoch budget</span><strong>{String(epoch.funded_budget_atoms)} atoms</strong></div><div className="metric"><span>Allocated</span><strong>{allocated.toString()} atoms</strong></div><div className="metric"><span>Confirmed paid</span><strong>{paid.toString()} atoms</strong></div><div className="metric"><span>Allocated, not paid</span><strong>{(allocated - paid).toString()} atoms</strong></div></div>
        {batches.map((batch) => <div className="proof-link" key={String(batch.id)}><strong>{String(batch.status).toUpperCase()}</strong> · {String(batch.amount_atoms)} atoms {batch.signature ? <a href={explorer(batch.signature)} target="_blank" rel="noreferrer">Transaction {String(batch.signature)}</a> : <span> · No signed transaction</span>}{batch.error_message ? <p role="status">Recovery required: {String(batch.error_message)}</p> : null}</div>)}
        <details><summary>Recipient allocations and receipts</summary><div className="allocation-list">{allocations.length ? allocations.map((item) => {
          const receipt = allocationReceipt(item, data.distributions ?? []);
          return <div key={item.wallet}><span className="mono">{item.wallet}</span><strong>{item.amount_atoms} atoms · {receipt.status}</strong>{receipt.signature && <a href={explorer(receipt.signature)} target="_blank" rel="noreferrer">View transaction</a>}</div>;
        }) : <p>No payable wallets in this epoch.</p>}</div></details>
        <details><summary>Eligibility snapshots and excluded-wallet reasons</summary>{data.snapshotsUnavailable ? <p>Snapshot records are temporarily unavailable.</p> : <><p className="notice">{data.snapshotsLimited ? "Showing a limited set of snapshot records; counts below are not full-epoch totals." : `${snapshots.filter((item) => item.status === "ELIGIBLE").length} eligible; ${snapshots.filter((item) => item.status !== "ELIGIBLE").length} excluded.`}</p><div className="allocation-list">{snapshots.map((item) => <div key={String(item.wallet)}><span className="mono">{String(item.wallet)}</span><strong>{String(item.status).replaceAll("_", " ")}</strong><span>{String(item.eligible_units_raw)} retained base units</span></div>)}</div></>}</details>
      </section>;
    })}</div> : <div className="empty">No reward epochs have been created yet. A launch alone is not evidence of a payout.</div>}
    {data.deposits.length > 0 && <section className="panel proof-section"><div className="section-label">Verified reward funding deposits</div>{data.deposits.map((deposit) => <a className="proof-link" key={String(deposit.signature)} href={explorer(deposit.signature)} target="_blank" rel="noreferrer">{String(deposit.amount_atoms)} reward atoms · slot {String(deposit.slot)} · {String(deposit.signature)}</a>)}</section>}
    {data.proofs.length > 0 && <section className="panel proof-section"><div className="section-label">Append-only transaction proofs</div>{data.proofs.map((proof, index) => proof.signature ? <a className="proof-link" key={index} href={explorer(proof.signature)} target="_blank" rel="noreferrer">{String(proof.kind)} · slot {String(proof.slot)} · {String(proof.signature)}</a> : <div className="proof-link" key={index}>{String(proof.kind)} · snapshot slot {String(proof.slot)}</div>)}</section>}
  </main>;
}
