"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Keypair, Transaction } from "@solana/web3.js";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import { getWallets } from "@wallet-standard/app";
import { VenueBadge } from "@/components/venue-badge";

const STONK_MINT = process.env.NEXT_PUBLIC_STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";

interface WalletAccountLike { address: string; chains: readonly string[] }
interface WalletLike {
  name: string;
  accounts: readonly WalletAccountLike[];
  features: Record<string, unknown>;
}
interface EventsFeature { on(event: "change", listener: (properties: { accounts?: readonly WalletAccountLike[] }) => void): () => void }
interface ConnectFeature { connect(): Promise<{ accounts: readonly WalletAccountLike[] }> }
interface SignTransactionFeature {
  signTransaction(input: { account: WalletAccountLike; transaction: Uint8Array; chain: string }): Promise<readonly { signedTransaction: Uint8Array }[]>;
}
const RECEIPT_KEY = "topblast-launch-receipt-v1";
interface Receipt { launchId: string; paymentSignature: string }
interface Prepared {
  raw?: { mintSignerRequired?: boolean; creationMethod?: string; venueFees?: { denominator: string; protocolRate: string; platformRate: string; creatorRate: string } };
  logo: string;
  launchId: string;
  signedQuote: string;
  paymentTransaction: string;
  payment: { lamports?: string | number; sol?: string | number; recipient?: string };
  expiresAt?: string;
  review: { name: string; symbol: string; venue: string; quoteSymbol: string; allocation: typeof initialAllocation };
}
const initialAllocation = { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 };

const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const encodeBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));

export function LaunchForm({ testMode = false }: { testMode?: boolean }) {
  const receiptKey = testMode ? `${RECEIPT_KEY}-test` : RECEIPT_KEY;
  const [venue, setVenue] = useState<"stonkfun" | "pumpfun">("stonkfun");
  const mintSigner = useRef<Keypair | null>(null);
  const [wallet, setWallet] = useState<WalletAccountLike | null>(null);
  const [wallets, setWallets] = useState<readonly WalletLike[]>([]);
  const [selectedWallet, setSelectedWallet] = useState("");
  const [walletName, setWalletName] = useState("");
  const [walletObject, setWalletObject] = useState<WalletLike | null>(null);
  const [allocation, setAllocation] = useState(initialAllocation);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [runtime, setRuntime] = useState<{ ready: boolean; missing: string[]; stonkBlockers?: string[]; pumpReady: boolean; pumpBlockers: string[] } | null>(null);
  const venueReady = Boolean(venue === "stonkfun" ? runtime?.ready : runtime?.pumpReady);
  const total = useMemo(() => allocation.topblastPercent + allocation.creatorPercent + allocation.protocolPercent, [allocation]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(receiptKey);
      if (saved) { const parsed = JSON.parse(saved); if (typeof parsed.launchId === "string" && typeof parsed.paymentSignature === "string") setReceipt(parsed); }
    } catch { /* Storage may be unavailable; in-memory state still prevents resubmission. */ }
    fetch(testMode ? "/api/launch/test-readiness" : "/api/health", { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (testMode && !response.ok) throw new Error(body.error ?? "Test availability check failed"); return body; })
      .then((body) => setRuntime(testMode ? body : { ready: body.venues?.stonkfun ? body.venues.stonkfun.launchReady === true : body.ready === true, stonkBlockers: body.venues?.stonkfun?.blockers ?? [], missing: body.missing ?? [], pumpReady: body.venues?.pumpfun?.launchReady === true, pumpBlockers: body.venues?.pumpfun?.blockers ?? ["Pump.fun readiness has not been verified"] }))
      .catch((caught) => { if (testMode) setError(caught instanceof Error ? caught.message : "Test availability check failed"); setRuntime({ ready: false, missing: ["runtime health check"], stonkBlockers: ["Test or infrastructure checks unavailable"], pumpReady: false, pumpBlockers: ["Runtime health check unavailable"] }); });
  }, [receiptKey, testMode]);

  async function checkTestAccess() {
    setBusy(true); setError(""); setRuntime(null);
    try {
      const response = await fetch("/api/launch/test-readiness", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Test availability check failed");
      setRuntime(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Test readiness unavailable"); }
    finally { setBusy(false); }
  }

  function requestHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  useEffect(() => {
    const registry = getWallets();
    const refresh = () => { const items = registry.get() as readonly WalletLike[]; setWallets(items); setSelectedWallet((current) => current || items[0]?.name || ""); };
    refresh();
    return registry.on("register", refresh);
  }, []);

  useEffect(() => {
    const events = walletObject?.features["standard:events"] as EventsFeature | undefined;
    if (!events) return;
    return events.on("change", ({ accounts }) => {
      if (!accounts) return;
      const next = accounts.find((item) => item.chains.includes("solana:mainnet")) ?? null;
      if (next?.address === wallet?.address) return;
      setWallet(next);
      if (prepared && !receipt) setPrepared(null);
      setError(next ? "Wallet account changed. Prepare a fresh transaction review." : "Wallet disconnected. Reconnect before continuing.");
    });
  }, [walletObject, wallet?.address, prepared, receipt]);

  useEffect(() => {
    if (!receipt) return;
    const timer = window.setInterval(() => { void checkStatus(true); }, 8_000);
    return () => window.clearInterval(timer);
  // checkStatus deliberately follows the current receipt value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.launchId, receipt?.paymentSignature]);

  async function connect() {
    setError("");
    const candidate = wallets.find((item) => item.name === selectedWallet && item.features["standard:connect"] && item.features["solana:signTransaction"]);
    if (!candidate) throw new Error("Install a Wallet Standard Solana wallet to continue");
    const response = await (candidate.features["standard:connect"] as ConnectFeature).connect();
    const account = response.accounts.find((item) => item.chains.includes("solana:mainnet"));
    if (!account) throw new Error("This launch requires a wallet account that supports Solana mainnet");
    setWallet(account); setWalletName(candidate.name); setWalletObject(candidate);
  }

  async function prepare(form: FormData) {
    setBusy(true); setError(""); setResult(null);
    try {
      const connected = wallet;
      if (!connected) { await connect(); throw new Error("Wallet connected. Review the form, then launch again."); }
      if (!logo) throw new Error("Choose a PNG, JPEG, or WebP image");
      if (total !== 100) throw new Error("Fee allocation must total 100%");
      mintSigner.current = Keypair.generate();
      const payload = {
        venue, isTest: testMode, pumpMint: venue === "pumpfun" ? mintSigner.current.publicKey.toBase58() : undefined,
        launchMint: venue === "stonkfun" ? mintSigner.current.publicKey.toBase58() : undefined,
        creatorWallet: connected.address,
        name: form.get("name"), symbol: form.get("symbol"), description: form.get("description"), logo,
        quoteMint: venue === "pumpfun" ? "So11111111111111111111111111111111111111112" : STONK_MINT, quoteSymbol: venue === "pumpfun" ? "SOL" : "STONK", feeTier: form.get("feeTier") ?? "1%", allocation,
        website: form.get("website"), twitter: form.get("twitter"), telegram: form.get("telegram"),
      };
      const response = await fetch("/api/launch/prepare", { method: "POST", headers: requestHeaders(), body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not prepare launch");
      setPrepared({ ...body, logo, review: { venue, quoteSymbol: payload.quoteSymbol, name: String(payload.name), symbol: String(payload.symbol).toUpperCase(), allocation: { ...allocation } } });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare launch"); }
    finally { setBusy(false); }
  }

  function complete(body: Record<string, string>) {
    if (body.status !== "completed") throw new Error(body.status === "failed" ? "The venue reports a failed launch. Keep this receipt and verify the payment before starting again." : "The launch is still processing. Use Check launch status; do not pay again.");
    setResult({ mint: String(body.mint), pool: String(body.pool), signature: String(body.signature ?? body.paymentSignature), trackerStatus: String(body.trackerStatus ?? "pending") });
    setPrepared(null);
    if (body.trackerStatus === "active") {
      setReceipt(null);
      try { localStorage.removeItem(receiptKey); } catch { /* No signing depends on storage. */ }
    }
  }

  async function checkStatus(quiet = false) {
    if (!receipt) return;
    if (!quiet) setBusy(true); setError("");
    try {
      const response = await fetch(`/api/launch/status/${encodeURIComponent(receipt.paymentSignature)}?launchId=${encodeURIComponent(receipt.launchId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not verify payment status. Keep this receipt and do not pay again.");
      complete(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Status check failed"); }
    finally { if (!quiet) setBusy(false); }
  }

  async function signAndSubmit() {
    if (!prepared || !wallet || !walletObject || receipt || busy) return;
    setBusy(true); setError("");
    try {
      const signer = walletObject.features["solana:signTransaction"] as SignTransactionFeature;
      if (!walletObject.accounts.some((account) => account.address === wallet.address && account.chains.includes("solana:mainnet"))) throw new Error("Wallet account changed or disconnected. Reconnect and prepare a fresh review.");
      if (prepared.expiresAt && new Date(prepared.expiresAt).getTime() <= Date.now()) throw new Error("Quote expired. Edit details and prepare a fresh review.");
      let bytes = decodeBase64(prepared.paymentTransaction);
      if (prepared.review.venue === "pumpfun" || prepared.raw?.mintSignerRequired) {
        if (!mintSigner.current) throw new Error("Mint preparation expired. Prepare a fresh review.");
        const tx = Transaction.from(bytes);
        tx.partialSign(mintSigner.current);
        bytes = new Uint8Array(tx.serialize({ requireAllSignatures: false }));
      }
      const signed = await signer.signTransaction({ account: wallet, transaction: bytes, chain: "solana:mainnet" });
      const signedTransaction = signed[0]?.signedTransaction;
      if (!signedTransaction) throw new Error("Wallet did not return a signed transaction");
      const pending = { launchId: prepared.launchId, paymentSignature: paymentSignatureFromTransaction(signedTransaction) };
      setReceipt(pending);
      // Save only public identifiers, never signed transaction bytes or wallet secrets.
      try { localStorage.setItem(receiptKey, JSON.stringify(pending)); } catch { /* Show the receipt in the UI. */ }
      const response = await fetch("/api/launch/submit", { method: "POST", headers: requestHeaders(), body: JSON.stringify({ launchId: prepared.launchId, signedQuote: prepared.signedQuote, signedTransaction: encodeBase64(signedTransaction), logo: prepared.logo }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not confirm launch submission. Check status before taking any further action.");
      complete(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Launch failed"); }
    finally { setBusy(false); }
  }

  const walletPicker = !wallet && <div className="wallet-picker"><select aria-label="Wallet" disabled={busy} value={selectedWallet} onChange={(event) => setSelectedWallet(event.target.value)}>{wallets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button className="button button-secondary" type="button" disabled={busy} onClick={() => void connect().catch((caught) => setError(caught instanceof Error ? caught.message : "Wallet connection failed"))}>Connect wallet</button></div>;

  return (
    <form className={`panel launch-form venue-theme-${venue}`} onSubmit={(event) => { event.preventDefault(); void prepare(new FormData(event.currentTarget)); }}>
      {testMode && <section className="form-section"><div className="section-label">Test with your own wallet</div><p className="notice">1. Connect wallet. 2. Choose your venue and token details. 3. Review the cost and approve in your wallet.</p><p className="notice">Real mainnet costs. Hidden on TopBlast, not private onchain or at the venue. No token is created until you approve the reviewed transaction. Reward payouts remain separately gated.</p>{walletPicker}{wallet && <p className="notice">Connected: <span className="mono">{wallet.address}</span></p>}<p className="notice" role="status">{!runtime ? "Checking test availability..." : venueReady ? "Test launch available. No access token required." : "Testing unavailable. Check the message below or retry."}</p><button type="button" className="button button-secondary" disabled={busy || Boolean(prepared)} onClick={() => void checkTestAccess()}>Refresh test availability</button></section>}
      {runtime && !venueReady && <div className="error"><strong>{venue === "pumpfun" ? "Pump.fun activation pending." : "Launch activation pending."}</strong> The transaction button stays locked until infrastructure checks pass. No payment can be submitted here.<ul>{(venue === "pumpfun" ? runtime.pumpBlockers : runtime.stonkBlockers ?? []).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      <fieldset disabled={busy || Boolean(prepared) || Boolean(receipt)}>
      <div className="launch-venue-hint"><VenueBadge venue={venue} /><span>{venue === "pumpfun" ? "SOL pair · WSOL rewards" : "STONK pair · STONK rewards"}</span></div>
      <div className="form-grid">
        <div className="field full"><label htmlFor="venue">Launch venue</label><select id="venue" value={venue} onChange={(event) => setVenue(event.target.value as typeof venue)}><option value="stonkfun">StonkFun · STONK pair</option><option value="pumpfun">Pump.fun · SOL pair</option></select>{venue === "pumpfun" && <p className="notice">Regular Pump.fun token with TopBlast deposit-funded rewards paid in WSOL. Pump.fun native holder rewards are separate and are not enabled. Tracking pauses at graduation until the new market is verified.</p>}</div>
        <div className="field"><label htmlFor="name">Token name</label><input id="name" name="name" required maxLength={32} placeholder="Top Coin" /></div>
        <div className="field"><label htmlFor="symbol">Ticker</label><input id="symbol" name="symbol" required maxLength={10} placeholder="TOP" /></div>
        <div className="field full"><label htmlFor="description">Description</label><textarea id="description" name="description" maxLength={500} placeholder="What this token is for." /></div>
        <div className="field full"><label htmlFor="image">Image</label><input id="image" name="image" type="file" required accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; setLogo(""); if (!file) return; if (file.size > 2_000_000) { setError("Image must be 2 MB or smaller"); return; } setLogo(await toDataUrl(file)); }} /></div>
        <div className="field"><label htmlFor="twitter">X URL</label><input id="twitter" name="twitter" type="url" placeholder="https://x.com/..." /></div>
        <div className="field"><label htmlFor="website">Website URL</label><input id="website" name="website" type="url" placeholder="https://..." /></div>
        <div className="field"><label htmlFor="telegram">Telegram URL</label><input id="telegram" name="telegram" type="url" placeholder="https://t.me/..." /></div>
        {venue === "stonkfun" && <p className="notice">Created through StonkFun’s standard LaunchLab configuration. Venue trading fees are set onchain by StonkFun and shown in the review. TopBlast allocation applies only to explicit reward-funding deposits.</p>}
      </div>
      <div className="form-section">
        <div className="section-label">Pair</div>
        <h3>{venue === "pumpfun" ? "SOL" : "STONK"}</h3>
        <p className="notice mono">{venue === "pumpfun" ? "So11111111111111111111111111111111111111112" : STONK_MINT}</p>
      </div>
      <div className="form-section">
        <div className="section-label">TopBlast rewards</div>
        <h3>Fund the blast zone.</h3>
        <p className="notice">When eligible holders fall below their verified average entry, they share the funded TopBlast reward pool. Creators claim venue fees to their wallet, then deposit a declared gross amount through the creator dashboard, and the fixed allocation is enforced by that transaction.</p>
        <div className="allocation-grid">
          {(["topblastPercent", "creatorPercent", "protocolPercent"] as const).map((key) => (
            <label className="allocation" key={key}>
              <span className="section-label">{key === "topblastPercent" ? "TopBlast rewards" : key === "creatorPercent" ? "Creator" : "Protocol"}</span>
              <input type="number" min="0" max="100" value={allocation[key]} onChange={(event) => setAllocation({ ...allocation, [key]: Number(event.target.value) })} />
              <input type="range" min="0" max="100" value={allocation[key]} onChange={(event) => setAllocation({ ...allocation, [key]: Number(event.target.value) })} />
            </label>
          ))}
        </div>
        <p className="notice">Total: {total}% {total === 100 ? "" : " Must equal 100%."}</p>
      </div>
      </fieldset>
      {prepared && !receipt && (
        <div className="panel" style={{ background: "#fff5d7" }}>
          <div className="section-label">Transaction review</div>
          <div className="token-venue"><VenueBadge venue={prepared.review.venue} /></div>
          {testMode && <p className="notice"><strong>TEST LAUNCH · HIDDEN FROM PUBLIC TOPBLAST PAGES</strong><br />This is a real Solana mainnet transaction, not a simulation-only launch.</p>}
          <h3>{prepared.review.name} · ${prepared.review.symbol}</h3>
          <p className="notice">Venue: {prepared.review.venue === "pumpfun" ? "Pump.fun" : "StonkFun"}. Pair: {prepared.review.symbol} / {prepared.review.quoteSymbol}. Allocation: {prepared.review.allocation.topblastPercent}% rewards, {prepared.review.allocation.creatorPercent}% creator retained, {prepared.review.allocation.protocolPercent}% protocol.</p>
          {prepared.review.venue === "pumpfun" && <p className="notice">Shown SOL cost is the simulated debit for network fees and account creation. No initial buy. Creator fees follow Pump.fun’s schedule. TopBlast rewards require a separate creator deposit.</p>}
          {prepared.raw?.creationMethod === "stonk_launchlab" && <p className="notice">StonkFun standard launch through its published LaunchLab configuration. Shown SOL cost covers simulated network fees and account rent, not an initial buy or reward funding. Stonk’s token listing may take time to appear.</p>}
          {prepared.raw?.venueFees && <p className="notice">Venue trading fees: {((Number(prepared.raw.venueFees.protocolRate) + Number(prepared.raw.venueFees.platformRate) + Number(prepared.raw.venueFees.creatorRate)) / Number(prepared.raw.venueFees.denominator) * 100).toFixed(2)}% total, including {(Number(prepared.raw.venueFees.creatorRate) / Number(prepared.raw.venueFees.denominator) * 100).toFixed(2)}% creator fee. These are separate from the TopBlast deposit allocation.</p>}
          <p className="notice">Network: Solana mainnet. Fee payer: <span className="mono">{wallet?.address}</span>. Estimated SOL debit: {prepared.payment.sol ?? prepared.payment.lamports ?? "See wallet"} {prepared.payment.sol !== undefined ? "SOL" : "lamports"}. Launch program: <span className="mono">{prepared.payment.recipient ?? "Shown by your wallet"}</span>. Quote expires: {prepared.expiresAt ? new Date(prepared.expiresAt).toLocaleTimeString() : "about 90 seconds after preparation"}.</p>
          <button type="button" className="button" disabled={busy} onClick={signAndSubmit}>Confirm in wallet</button> <button type="button" className="button button-secondary" disabled={busy} onClick={() => setPrepared(null)}>Edit details</button>
        </div>
      )}
      {receipt && <div className="panel" style={{ marginTop: 20 }} role="status"><h3>Payment verification pending</h3><p className="notice">Keep this receipt. Check status to recover after a delay or refresh. Do not make another payment.</p><p className="mono">Launch: {receipt.launchId}<br />Payment: {receipt.paymentSignature}</p><button type="button" className="button" disabled={busy} onClick={() => void checkStatus()}>Check launch status</button></div>}
      {error && <div className="error">{error}</div>}
      {result && <div className={result.trackerStatus === "active" ? "success" : "error"}><strong>{result.trackerStatus === "active" ? "Launch complete. TopBlast tracking active." : "Token launched. Tracker registration needs recovery."}</strong><br />Mint: {result.mint}<br />Pool: {result.pool}<br />Signature: {result.signature}{result.trackerStatus !== "active" && <><br />Use the saved payment status recovery to retry tracking. No second payment is required.</>}</div>}
      <div className="form-footer">
        <p className="notice">Your wallet signs the reviewed launch transaction. TopBlast never receives your private key.</p>
        {!prepared && !receipt && !result && <button className="button venue-button" disabled={busy || total !== 100 || !venueReady}>{busy ? "Preparing..." : !venueReady ? "Activation pending" : wallet ? venue === "pumpfun" ? "Launch on Pump.fun" : "Launch on STONK" : "Connect and launch"}</button>}
      </div>
      {!testMode && walletPicker}
      {wallet && <p className="notice">Connected: {walletName} · <span className="mono">{wallet.address}</span></p>}
    </form>
  );
}
