"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VenueBadge } from "@/components/venue-badge";
import { advanceRehearsal, newRehearsal, REHEARSAL_KEY, rehearsalAmount, rehearsalPlan, rehearsalSchema, runRehearsal, type RehearsalState } from "@/lib/testing/rehearsal";

const steps = ["Create fictional launch", "Replay sample buys", "Add sample funding", "Snapshot + allocate", "Interrupt sample payouts", "Recover + show sample proof"];
interface Health { launchReady: boolean; rewardsReady: boolean; missing: string[]; checks: Record<string, boolean | string | number | null> }

export function Rehearsal() {
  const [state, setState] = useState(newRehearsal);
  const [loaded, setLoaded] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [checking, setChecking] = useState(false);
  const plan = rehearsalPlan(state);
  const other = rehearsalPlan(state, "SIM-B");
  const quote = state.venue === "pumpfun" ? "SOL" : "STONK";
  const reward = state.venue === "pumpfun" ? "WSOL" : "STONK";

  async function checkHealth() {
    setChecking(true); setHealthError("");
    try {
      const response = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = await response.json();
      if (typeof body.launchReady !== "boolean" || !body.checks || !Array.isArray(body.missing)) throw new Error("Unexpected health response");
      setHealth(body);
    } catch { setHealth(null); setHealthError("Live status could not be checked. The rehearsal still works. Retry the live check below."); }
    finally { setChecking(false); }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REHEARSAL_KEY);
      if (saved) {
        const parsed = rehearsalSchema.safeParse(JSON.parse(saved));
        if (parsed.success) { setState(parsed.data); setStorageNotice("Saved rehearsal restored. This is local test data, not an onchain receipt."); }
        else setStorageNotice("Older test data could not be restored. Starting a fresh rehearsal.");
      }
    } catch { setStorageNotice("Browser storage is unavailable or test data is unreadable. This rehearsal works in this tab, but refresh recovery may be unavailable."); }
    setLoaded(true);
    void checkHealth();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(REHEARSAL_KEY, JSON.stringify(state)); }
    catch { setStorageNotice("Browser storage is unavailable. Keep this tab open to retain your rehearsal."); }
  }, [state, loaded]);

  function changeScenario(change: Partial<RehearsalState>) {
    setState((current) => ({ ...current, ...change, step: 0, paidKeys: [], recoveryRuns: 0 }));
    setStorageNotice("Scenario changed. Run the rehearsal again to calculate a fresh result.");
  }

  function downloadProof() {
    const report = { mode: "SIMULATION_ONLY", realTransactions: [], warning: "Not onchain proof. Launch, funding, and transport are simulated. Production position and allocation functions are reused.", scenario: state, launchA: plan, launchB: other };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "topblast-SIMULATED-rehearsal.json"; link.click(); URL.revokeObjectURL(url);
  }

  return <>
    <div className="test-disclaimer"><strong>SIMULATION ONLY · NOT DEVNET</strong><p>StonkFun’s published API does not document a devnet launch endpoint. This rehearsal never calls launch, funding, or payout APIs. All amounts, wallets, slots, and payment states below are fictional. It does not establish live launch or reward readiness.</p></div>
    <div className="test-grid">
      <section className={`panel test-controls venue-theme-${state.venue}`} aria-label="Rehearsal controls">
        <div className="eyebrow">01 / CHOOSE A SCENARIO</div><h2>BOUGHT IN.<br />WHAT NEXT?</h2>
        <div className="creator-venue"><VenueBadge venue={state.venue} /></div>
        <div className="field"><label htmlFor="test-venue">Sample launch venue</label><select id="test-venue" value={state.venue} onChange={(event) => changeScenario({ venue: event.target.value as RehearsalState["venue"] })}><option value="stonkfun">StonkFun · STONK</option><option value="pumpfun">Pump.fun · SOL / WSOL rewards</option></select></div>
        {state.venue === "pumpfun" && <p className="notice">Pump.fun mode: per-mint creator-fee sharing funds the isolated pool. SOL receipts are wrapped into WSOL only when transferred to creators or holders. No swap. Production tracking pauses at unsupported graduation.</p>}
        <p>Holder A buys 10 tokens at 10 {quote} and 10 at 20 {quote}. Weighted entry: 15 {quote}. Holder B buys 10 at 10 {quote}. These are fictional teaching amounts, not live market prices.</p>
        <div className="field"><label htmlFor="test-price">Sample price: {state.price} {quote} / token</label><input id="test-price" type="range" min="1" max="30" value={state.price} onChange={(event) => changeScenario({ price: Number(event.target.value) })} /></div>
        <div className="field"><label htmlFor="test-movement">Holder A activity this epoch</label><select id="test-movement" value={state.movement} onChange={(event) => changeScenario({ movement: event.target.value as RehearsalState["movement"] })}><option value="holding">Still holding</option><option value="sell">Sell 5 tokens</option><option value="outgoing_transfer">Transfer 5 tokens out</option><option value="incoming_transfer">Receive 5 tokens, no buy basis</option></select></div>
        <div className="field"><label htmlFor="test-funding">Sample gross revenue: {state.gross} {quote}</label><input id="test-funding" type="range" min="0" max="1000" step="10" value={state.gross} onChange={(event) => changeScenario({ gross: Number(event.target.value) })} /></div>
        <p className="notice">Example selection: 80% holder rewards / 20% creator. TopBlast’s fixed 10% protocol share is applied automatically underneath. In production, funding must have finalized launch-attributable proof before rewards become available.</p>
        <button className="button" disabled={!loaded} onClick={() => setState((current) => runRehearsal({ ...current, step: 0, paidKeys: [], recoveryRuns: 0 }))}>Run full rehearsal</button>
        <button className="button button-secondary" disabled={!loaded} onClick={() => setState((current) => advanceRehearsal(current))}>{state.step === 5 ? "Replay recovery check" : "Run next step"}</button>
        <button className="test-reset" disabled={!loaded} onClick={() => { setState(newRehearsal()); setStorageNotice("Rehearsal reset. No production data was changed."); }}>Reset test data</button>
        {storageNotice && <p className="notice" role="status">{storageNotice}</p>}
      </section>
      <section className="panel" aria-label="Rehearsal results">
        <div className="eyebrow">02 / FOLLOW THE LOOP</div>
        <ol className="test-steps">{steps.map((step, index) => <li key={step} className={state.step >= index ? "reached" : ""} aria-current={state.step === index ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step}</strong><small>{state.step >= index ? "Sample stage reached" : "Not run yet"}</small></div></li>)}</ol>
        <div className="test-balance-grid" aria-label="Simulated reward ledger">
          <div><small>Sample reward funding</small><strong>{rehearsalAmount(plan.fundedBudgetQuoteAtoms)}</strong></div><div><small>Available</small><strong>{rehearsalAmount(plan.available)}</strong></div><div><small>Reserved, not paid</small><strong>{rehearsalAmount(plan.reserved)}</strong></div><div><small>Simulated paid</small><strong>{rehearsalAmount(plan.paid)}</strong></div>
        </div><p className="notice">Fictional {reward} units. “Reserved” is not “paid.” Actual reward mint decimals are discovered onchain in production.</p>
        <div className="test-result" role="status"><strong>{state.step === 5 ? "REHEARSAL COMPLETE" : state.step === 4 ? "SAMPLE PAYOUT INTERRUPTED" : "SAFE TO EXPERIMENT"}</strong><p>{state.step === 5 ? `Local recovery ran ${state.recoveryRuns} time(s). ${state.paidKeys.length} unique simulated payment key(s). Replay recovery or refresh this page; completed keys should not multiply.` : state.step === 4 ? "Only the first allocation is marked simulated paid. Refresh, then run the next step to recover the remaining sample allocations." : "Run the full rehearsal, or advance one stage at a time. Change price, activity, or funding to test another outcome."}</p></div>
      </section>
    </div>
    {state.step >= 1 && <section className="panel test-section"><div className="eyebrow">03 / VERIFIED ENTRY RULES</div><h3>Sample holder lookup</h3><div className="test-table-wrap"><table className="proof-table"><thead><tr><th>Fictional wallet</th><th>Average entry</th><th>Retained verified units</th><th>Position status</th><th>Sample allocation</th></tr></thead><tbody>{plan.snapshots.map((item) => <tr key={item.wallet}><td>{item.wallet}</td><td>{rehearsalAmount(item.averageEntryQuoteAtoms)} {quote}</td><td>{item.eligibleUnitsRaw.toString()}</td><td>{item.status.replaceAll("_", " ")}</td><td>{state.step >= 3 ? `${rehearsalAmount(plan.allocations.find((allocation) => allocation.wallet === item.wallet)?.amountQuoteAtoms ?? 0n)} ${reward}` : "Not allocated"}</td></tr>)}</tbody></table></div><p className="notice">The transfer-only wallet has no purchased cost basis. Incoming units never fabricate entry. Sells and outgoing transfers exclude Holder A for this sample epoch.</p></section>}
    <section className="panel test-section"><div className="eyebrow">04 / TWO-LAUNCH ISOLATION</div><h3>Same holders. Separate budgets.</h3><p>SIM-B has the same sample wallets, but no funding. Its allocations remain {rehearsalAmount(other.distributedQuoteAtoms)} {reward} regardless of SIM-A’s budget.</p>{state.step === 5 && <><button className="button button-secondary" onClick={downloadProof}>Download simulated report</button><p className="notice">No transaction signatures or explorer receipts are fabricated. A local recovery rehearsal is not a production worker restart test.</p></>}</section>
    <section className="panel test-section" aria-label="Actual production readiness"><div className="eyebrow">LIVE INFRASTRUCTURE / NOT SIMULATED</div><h3>{checking ? "Checking production…" : health?.rewardsReady ? "Production reports an accepted payout" : "Real-money acceptance still required"}</h3>
      {healthError && <p className="error" role="alert">{healthError}</p>}
      {health && <><ul className="test-checks"><li>Database: <strong>{health.checks.databaseReachable ? "Connected" : "Unavailable"}</strong></li><li>StonkFun STONK pair: <strong>{health.checks.stonkPairReady ? "Available" : "Unavailable"}</strong></li><li>Indexer configured: <strong>{health.checks.indexerConfigured ? "Yes" : "No"}</strong></li><li>Worker heartbeat: <strong>{health.checks.workerFresh ? "Recent" : "Missing or stale"}</strong></li><li>Live launches: <strong>{health.launchReady ? "Enabled for controlled testing" : "Locked"}</strong></li><li>Dry run: <strong>{health.checks.dryRun ? "On, no live payouts" : "Off"}</strong></li></ul>{health.missing.length > 0 && <p className="notice">Missing configuration: {health.missing.join(", ")}.</p>}</>}
      <p>To test a real StonkFun launch, the operator must configure public reward and protocol treasury addresses and enable controlled launches. A separate creator wallet approves the reviewed launch fee. Reward acceptance then requires a verified buy, an explicit STONK deposit, an eligible finalized snapshot, and a confirmed direct holder payout.</p>
      <p className="notice">Never paste private keys or seed phrases here or in chat. Funding SOL for transaction fees does not fund STONK rewards. No need to send 10 SOL blindly.</p>
      <div className="hero-actions"><button className="button button-secondary" disabled={checking} onClick={() => void checkHealth()}>Recheck live status</button><Link className="button" href="/launch">Open real launch form</Link></div>
    </section>
  </>;
}
