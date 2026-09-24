"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import { FundingPanel } from "@/components/funding-panel";
import { VenueBadge } from "@/components/venue-badge";
import { clientJson } from "@/lib/client-json";
import { formatTokenAtoms } from "@/lib/token-display";
import { allocationToCreatorShare } from "@/lib/launch-allocation";

interface Account { address: string; chains: readonly string[] }
interface Wallet { name: string; features: Record<string, unknown> }
interface Connect { connect(): Promise<{ accounts: readonly Account[] }> }
interface Events { on(event: "change", listener: (change: { accounts?: readonly Account[] }) => void): () => void }
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : value && typeof value === "object" ? [value as Row] : [];
export function CreatorDashboard() {
  const [launches, setLaunches] = useState<Row[]>([]);
  const [wallet, setWallet] = useState("");
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [selected, setSelected] = useState("");
  const [connected, setConnected] = useState<Wallet | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => { const found = registry.get().filter((item) => item.features["standard:connect"] && item.features["solana:signTransaction"]) as readonly Wallet[]; setWallets(found); setSelected((old) => old || found[0]?.name || ""); };
    refresh(); return registry.on("register", refresh);
  }, []);
  useEffect(() => {
    const events = connected?.features["standard:events"] as Events | undefined;
    return events?.on("change", ({ accounts }) => {
      if (!accounts) return;
      setWallet(accounts.find((account) => account.chains.includes("solana:mainnet"))?.address ?? "");
      setLaunches([]); setError("");
    });
  }, [connected]);
  useEffect(() => {
    if (!wallet) return;
    let current = true; setLoading(true); setError(""); setLaunches([]);
    clientJson(`/api/creator?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" }, 20_000, "Dashboard check timed out. Your receipts remain stored.")
      .then(({ response, body }) => { if (!response.ok || body.configured === false) throw new Error(body.error ?? "Creator data is unavailable"); if (current) setLaunches(body.launches ?? []); })
      .catch((caught) => { if (current) setError(caught.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [wallet, attempt]);
  async function connect() {
    setConnecting(true); setError("");
    try {
      const item = wallets.find((candidate) => candidate.name === selected);
      if (!item) throw new Error("Install or select a Solana wallet. No private key is needed.");
      const result = await (item.features["standard:connect"] as Connect).connect();
      const account = result.accounts.find((candidate) => candidate.chains.includes("solana:mainnet"));
      if (!account) throw new Error("Switch your wallet to Solana mainnet");
      setConnected(item); setWallet(account.address);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not connect"); }
    finally { setConnecting(false); }
  }
  return <>
    <div className="lookup"><select aria-label="Creator wallet provider" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="" disabled>Select wallet</option>{wallets.map((item) => <option key={item.name}>{item.name}</option>)}</select><button className="button" disabled={connecting} onClick={connect}>{connecting ? "Connecting…" : wallet ? "Switch creator wallet" : "Connect creator wallet"}</button>{wallet && <button className="button button-secondary" disabled={loading} onClick={() => setAttempt(attempt + 1)}>Refresh</button>}</div>
    {wallet && <p className="mono">{wallet}</p>}
    <p className="notice">Viewing public launch records does not grant spending permission. Each funding or payout transaction requires its own exact wallet approval.</p>
    {error && <div className="error" role="alert">{error}<button className="button button-secondary button-small" onClick={() => setAttempt(attempt + 1)}>Retry</button></div>}
    {loading && <div className="empty" role="status">Loading your launch ledgers…</div>}
    {wallet && !loading && !error && (launches.length ? <div className="creator-launches">{launches.map((launch) => {
      const config = rows(launch.launch_configs)[0];
      const funding = rows(launch.launch_funding_balances)[0];
      const market = rows(launch.tracked_markets)[0];
      const epochs = rows(launch.reward_epochs).sort((a, b) => Number(b.sequence) - Number(a.sequence));
      const deposits = rows(launch.funding_deposits), batches = rows(launch.payout_batches);
      const decimals = market?.quote_decimals == null ? null : Number(market.quote_decimals);
      const asset = launch.venue === "pumpfun" ? "WSOL" : String(launch.quote_symbol ?? "quote asset");
      const amount = (value: unknown) => decimals === null ? `${String(value ?? 0)} atoms` : `${formatTokenAtoms(value ?? "0", decimals)} ${asset}`;
      const publicPage = Boolean(launch.mint && !launch.listing_hidden && (!launch.is_test || launch.public_test_listing));
      const gross = deposits.reduce((sum, row) => sum + BigInt(String(row.gross_amount_atoms)), 0n);
      const venueFees = launch.venue_fee_status as Row | undefined;
      const forwarding = venueFees?.forwarding as Row | undefined;
      const receiver = launch.fee_receiver as Row | undefined;
      const receiverStatus = receiver?.status as Row | undefined;
      const visibleSplit = allocationToCreatorShare({ topblastPercent: Number(config?.topblast_percent ?? 0), creatorPercent: Number(config?.creator_percent ?? 0) });
      return <article className="panel" key={String(launch.id)}>
        <div className="token-card-head"><div><h3>{String(launch.name)} · ${String(launch.symbol)}</h3><VenueBadge venue={String(launch.venue)} /></div><span className="status-pill">{String(launch.status).toUpperCase()}</span></div>
        <p className="notice">{launch.listing_hidden ? "ARCHIVED LISTING · Records and receipts preserved." : launch.is_test ? launch.public_test_listing ? "CONTROLLED TEST · PUBLICLY LISTED" : "HIDDEN TEST · NOT PUBLICLY LISTED" : "PUBLIC LAUNCH"}</p>
        <p className="notice">Tracker: {String(launch.tracker_status ?? "pending")} · {market?.history_complete ? "Finalized history caught up" : "History incomplete: no payable eligibility yet"}</p>
        {launch.tracker_error ? <div className="error">Tracker recovery needed: {String(launch.tracker_error)}. Use your saved launch receipt to retry registration. Do not launch again.</div> : null}
        <details><summary>Token, market and launch split</summary><p className="mono">Token: {String(launch.mint ?? "Pending")}<br />Market: {String(launch.market_address ?? "Pending")}<br />Reward treasury: {String(config?.treasury_address ?? "Unavailable")}</p><p>{visibleSplit ? `${visibleSplit.topblastPercent}% holder rewards / ${visibleSplit.creatorPercent}% creator` : "Launch split unavailable"}. The creator-selected split totals 100% and is fixed for this launch.</p><p>{Number(config?.epoch_release_bps ?? 6500) / 100}% of the available holder-reward balance is released per epoch; the remainder carries forward for this launch.</p></details>
        <div className="stats-grid"><div className="metric"><span>Gross funding declared</span><strong>{amount(gross.toString())}</strong></div><div className="metric"><span>Available rewards</span><strong>{amount(funding?.available_atoms)}</strong></div><div className="metric"><span>Reserved</span><strong>{amount(funding?.reserved_atoms)}</strong></div><div className="metric"><span>Submitted, not paid</span><strong>{amount(funding?.submitted_atoms)}</strong></div><div className="metric"><span>Confirmed payouts</span><strong>{amount(funding?.paid_atoms)}</strong></div><div className="metric"><span>Current epoch</span><strong>{epochs[0] ? `${epochs[0].sequence} · ${epochs[0].status}` : "Not started"}</strong></div></div>
        <p className="notice">Funding mode: {launch.venue === "stonkfun" ? receiver ? "isolated Stonk fee wallet. Finalized transfers from this wallet fund only this token. The worker applies the fixed split and prepares eligible payouts automatically." : "legacy shared Stonk wallet. Automatic funding is blocked until the combined payment can be attributed to this token." : "verified Pump per-mint fee sharing. The worker credits only this mint’s finalized distribution receipt, then sends the creator share and holder rewards automatically."}</p>
        {receiver && <details><summary>Dedicated fee wallet & receipts</summary><p className="mono">{String(receiver.address)}</p><p className="notice">Status: {String(receiverStatus?.status ?? "Awaiting worker")}. {String(receiverStatus?.message ?? "")}</p><p className="notice">One-time operating top-up: 0.01 SOL. It is never counted as holder funding. Voluntary quote-token deposits to this wallet also belong to this launch.</p>{rows(receiver.operations).map((op, index) => <p className="notice" key={String(op.signature ?? index)}>{String(op.kind).toUpperCase()} · {String(op.status)} · {op.kind === "gas" ? "0.01 SOL operating funds" : amount(op.amount_atoms)} {op.signature ? <a href={`https://solscan.io/tx/${op.signature}`} target="_blank" rel="noreferrer">Receipt ↗</a> : ""}{op.error_message ? ` · ${op.error_message}` : ""}</p>)}</details>}
        <details><summary>Venue creator-fee status</summary><p className="notice">{String(venueFees?.reason ?? (venueFees?.claimable ? "The venue reports a creator-controlled claimable balance." : "No claimable balance reported."))}</p>{venueFees?.scope ? <p className="notice">Scope: {String(venueFees.scope)}. A creator-wide or quote-vault balance is not attributed to this launch until you make a verified TopBlast deposit.</p> : null}{venueFees?.claimable ? <pre className="notice" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(venueFees.claimable, null, 2)}</pre> : null}</details>
        {forwarding && <div className="notice"><strong>Stonk forwarding threshold: ${Number(forwarding.minimumForwardUsd).toFixed(2)} in creator fees.</strong><p>This token accrued: {formatTokenAtoms(forwarding.tokenAccruedAtoms, Number(forwarding.decimals))} {String(forwarding.quoteSymbol)}. Accrued fees are not funded TopBlast rewards.</p><p>{receiver ? "This launch uses its own receiver. Its balance is credited only after a finalized sweep into the reward treasury." : "Stonk can combine multiple tokens into one creator payment. Attribution must be verified before this legacy launch receives a reward budget."}</p>{forwarding.lastSignature ? <a href={`https://solscan.io/tx/${forwarding.lastSignature}`} target="_blank" rel="noreferrer">Latest venue payment ↗</a> : <span>No venue payment reported yet.</span>}</div>}
        {venueFees?.forwardingError ? <p className="notice">{String(venueFees.forwardingError)}</p> : null}
        {launch.venue === "pumpfun" && <p className="notice">PUMP BETA · Automatic per-mint fee sharing. No initial buy, native cashback, or mayhem. PumpSwap graduation is unsupported; tracking and new epochs pause at graduation.</p>}
        {publicPage && <div className="hero-actions"><Link className="button button-secondary" href={`/token/${launch.mint}`}>Open token</Link><Link className="button button-secondary" href={`/token/${launch.mint}/proof`}>Review epoch & proof</Link></div>}
        {launch.launch_signature ? <p className="notice"><a href={`https://solscan.io/tx/${launch.launch_signature}`} target="_blank" rel="noreferrer">Launch transaction ↗</a></p> : null}
        {["active", "paused"].includes(String(launch.status)) && <FundingPanel key={`${launch.id}:${wallet}`} launchId={String(launch.id)} creatorWallet={wallet} venue={String(launch.venue)} assetSymbol={asset} />}
        {deposits.length > 0 && <details><summary>Funding receipts</summary>{deposits.map((deposit) => <a className="proof-link" key={String(deposit.signature)} href={`https://solscan.io/tx/${deposit.signature}`} target="_blank" rel="noreferrer">{amount(deposit.amount_atoms)} to rewards · {String(deposit.block_time)}</a>)}</details>}
        {batches.length > 0 && <details><summary>Payout batches and recovery</summary>{batches.map((batch) => <p className="notice" key={String(batch.id)}>{String(batch.status).toUpperCase()} · {amount(batch.amount_atoms)} {batch.signature ? <a href={`https://solscan.io/tx/${batch.signature}`} target="_blank" rel="noreferrer">Transaction ↗</a> : "· Awaiting payout execution"}{batch.error_message ? ` · ${batch.error_message}` : ""}</p>)}<p className="notice">An authorized operator controls payout mode. Creator access alone cannot spend the treasury, and holders never submit claims.</p></details>}
      </article>;
    })}</div> : <div className="empty">No launches are associated with this creator wallet.</div>)}
  </>;
}
