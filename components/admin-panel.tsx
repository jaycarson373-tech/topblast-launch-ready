"use client";

import { useState } from "react";
import { getWallets } from "@wallet-standard/app";

interface Account { address: string; chains: readonly string[] }
interface Wallet { name: string; features: Record<string, unknown> }
interface Connect { connect(): Promise<{ accounts: readonly Account[] }> }
interface Sign { signTransaction(input: { account: Account; transaction: Uint8Array; chain: string }): Promise<readonly { signedTransaction: Uint8Array }[]> }
const decode = (value: string) => Uint8Array.from(atob(value), (item) => item.charCodeAt(0));
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));

export function AdminPanel() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const [launchId, setLaunchId] = useState("");
  const [epochId, setEpochId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [payout, setPayout] = useState<Record<string, unknown> | null>(null);
  const [wallet, setWallet] = useState<{ wallet: Wallet; account: Account } | null>(null);
  const authorization = { Authorization: `Bearer ${token}` };
  async function load() { const response = await fetch("/api/admin/action", { headers: authorization }); const body = await response.json(); if (!response.ok) { setMessage(body.error); return; } setStatus(body); setMessage(""); }
  async function action(name: string) { const response = await fetch("/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json", ...authorization }, body: JSON.stringify({ action: name, launchId, epochId }) }); const body = await response.json(); setMessage(response.ok ? JSON.stringify(body, null, 2) : body.error); if (response.ok) await load(); }
  async function payoutAction(actionName: "prepare" | "reconcile", id = batchId) {
    const response = await fetch("/api/admin/payout", { method: "POST", headers: { "Content-Type": "application/json", ...authorization }, body: JSON.stringify({ action: actionName, batchId: id }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); setPayout(body); setBatchId(id); setMessage(JSON.stringify(body, null, 2));
  }
  async function connectTreasury() {
    const item = (getWallets().get() as unknown as readonly Wallet[]).find((candidate) => candidate.features["standard:connect"] && candidate.features["solana:signTransaction"]);
    if (!item) throw new Error("No Wallet Standard Solana wallet found");
    const result = await (item.features["standard:connect"] as Connect).connect();
    const account = result.accounts.find((candidate) => candidate.chains.some((chain) => chain.startsWith("solana:")));
    if (!account) throw new Error("Wallet did not expose a Solana account");
    setWallet({ wallet: item, account });
  }
  async function signPayout() {
    if (!payout?.unsigned_transaction) throw new Error("Prepare a payout batch first");
    if (!wallet) { await connectTreasury(); throw new Error("Treasury wallet connected. Review the batch and click approve again."); }
    const signed = await (wallet.wallet.features["solana:signTransaction"] as Sign).signTransaction({ account: wallet.account, transaction: decode(String(payout.unsigned_transaction)), chain: "solana:mainnet" });
    if (!signed[0]) throw new Error("Wallet did not return a signed transaction");
    const response = await fetch("/api/admin/payout", { method: "POST", headers: { "Content-Type": "application/json", ...authorization }, body: JSON.stringify({ action: "submit", batchId, signedTransaction: encode(signed[0].signedTransaction) }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); setMessage(JSON.stringify(body, null, 2)); await load();
  }
  const metric = (label: string, key: string) => { const value = status?.[key]; return <div className="metric"><span>{label}</span><strong>{value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}</strong></div>; };
  const approvals = (status?.pendingApprovalBatches ?? []) as Array<Record<string, unknown>>;
  return <>
    <div className="panel"><div className="field"><label htmlFor="admin-token">Admin token</label><input id="admin-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} /><button className="button" type="button" onClick={load}>Load operational health</button></div></div>
    {status && <><div className="stats-grid">{metric("Active launches", "activeLaunches")}{metric("Tracker health", "trackerHealth")}{metric("Indexing lag", "indexingLag")}{metric("Worker fresh", "workerFresh")}{metric("Payout mode", "payoutMode")}{metric("Failed epochs", "failedEpochs")}{metric("Failed payouts", "failedPayouts")}{metric("Reconciliation problems", "reconciliationProblems")}{metric("Funding ledger by mint", "fundingBalances")}</div>{status.payoutMode === "server_signer" && <p className="notice">Automatic direct holder airdrops are enabled in the isolated Railway worker. Manual wallet controls below are recovery tools; do not approve a second transaction for an in-flight batch.</p>}</>}
    {approvals.length > 0 && <section className="panel proof-section"><div className="section-label">Payout approval queue</div>{approvals.map((batch) => <button type="button" className="approval-row" key={String(batch.id)} onClick={() => { setBatchId(String(batch.id)); void payoutAction(batch.status === "planned" ? "prepare" : "reconcile", String(batch.id)).catch((error) => setMessage(error.message)); }}><span>{String(batch.status).toUpperCase()} · batch {String(batch.sequence)}</span><strong>{String(batch.amount_atoms)} atoms</strong><small>{String(batch.id)}</small></button>)}</section>}
    <div className="panel proof-section"><div className="section-label">Safe controls</div><div className="form-grid" style={{ marginTop: 16 }}><div className="field"><label>Launch ID</label><input value={launchId} onChange={(event) => setLaunchId(event.target.value)} /><button className="button button-secondary" type="button" onClick={() => action("pause_launch")}>Pause specific launch</button></div><div className="field"><label>Epoch ID</label><input value={epochId} onChange={(event) => setEpochId(event.target.value)} /><button className="button button-secondary" type="button" onClick={() => action("retry_epoch")}>Retry failed epoch</button><button className="button button-secondary" type="button" onClick={() => action("dry_run_payout")}>Dry run payout</button></div><div className="field full"><label>Payout batch ID</label><input value={batchId} onChange={(event) => setBatchId(event.target.value)} /><div className="hero-actions"><button className="button button-secondary" type="button" onClick={() => void payoutAction("prepare").catch((error) => setMessage(error.message))}>Prepare exact transaction</button><button className="button" type="button" disabled={!payout?.unsigned_transaction} onClick={() => void signPayout().catch((error) => setMessage(error.message))}>Approve with treasury wallet</button><button className="button button-secondary" type="button" onClick={() => void payoutAction("reconcile").catch((error) => setMessage(error.message))}>Reconcile submitted</button></div></div></div><button className="button" style={{ marginTop: 20 }} type="button" onClick={() => action("pause_engine")}>Pause reward engine</button> <button className="button button-secondary" type="button" onClick={() => action("resume_engine")}>Enable epoch planning</button>{wallet && <p className="notice">Approval wallet: <span className="mono">{wallet.account.address}</span></p>}{message && <pre className="notice" style={{ marginTop: 16, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message}</pre>}</div>
  </>;
}
