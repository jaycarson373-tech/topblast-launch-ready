"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Keypair, Transaction } from "@solana/web3.js";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import { getWallets } from "@wallet-standard/app";
import { VenueBadge } from "@/components/venue-badge";
import Image from "next/image";
import { initialCreatorShare, updateCreatorShare, creatorShareToAllocation, CREATOR_SHARE_STEP, CREATOR_REWARD_PERCENT, FIXED_PROTOCOL_PERCENT } from "@/lib/launch-allocation";
import { validateTokenImage } from "@/lib/token-image";
import { clientJson } from "@/lib/client-json";

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
interface LaunchStatus { status: string; mint?: string; pool?: string; signature?: string; paymentSignature?: string; trackerStatus?: string; retrySafe?: boolean; failureMessage?: string }
interface Prepared {
  raw?: { mintSignerRequired?: boolean; creationMethod?: string; venueFees?: { denominator: string; protocolRate: string; platformRate: string; creatorRate: string } };
  logo: string;
  launchId: string;
  signedQuote: string;
  paymentTransaction: string;
  payment: { lamports?: string | number; sol?: string | number; recipient?: string };
  expiresAt?: string;
  review: { name: string; symbol: string; venue: string; quoteSymbol: string; allocation: ReturnType<typeof creatorShareToAllocation>; creatorShare: typeof initialCreatorShare };
}

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
  const [creatorShare, setCreatorShare] = useState(initialCreatorShare);
  const allocation = useMemo(() => creatorShareToAllocation(creatorShare), [creatorShare]);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const receiptRef = useRef<Receipt | null>(null);
  receiptRef.current = receipt;
  const statusRequest = useRef(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [autoCheckPaused, setAutoCheckPaused] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retrySafe: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [logo, setLogo] = useState("");
  const [imageName, setImageName] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const imageReadId = useRef(0);
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
    clientJson(testMode ? "/api/launch/test-readiness" : "/api/health", { cache: "no-store" }, 25_000, "Launch availability check timed out")
      .then(({ response, body }) => { if (!response.ok) throw new Error(body.error ?? "Launch availability check failed"); return body; })
      .then((body) => setRuntime(testMode ? body : { ready: body.venues?.stonkfun ? body.venues.stonkfun.launchReady === true : body.ready === true, stonkBlockers: body.venues?.stonkfun?.blockers ?? [], missing: body.missing ?? [], pumpReady: body.venues?.pumpfun?.launchReady === true, pumpBlockers: body.venues?.pumpfun?.blockers ?? ["Pump.fun readiness has not been verified"] }))
      .catch((caught) => { if (testMode) setError(caught instanceof Error ? caught.message : "Test availability check failed"); setRuntime({ ready: false, missing: ["runtime health check"], stonkBlockers: ["Test or infrastructure checks unavailable"], pumpReady: false, pumpBlockers: ["Runtime health check unavailable"] }); });
  }, [receiptKey, testMode]);

  async function checkTestAccess() {
    setBusy(true); setError(""); setRuntime(null);
    try {
      const { response, body } = await clientJson("/api/launch/test-readiness", { cache: "no-store" }, 25_000, "Test availability check timed out");
      if (!response.ok) throw new Error(body.error ?? "Test availability check failed");
      setRuntime(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Test readiness unavailable"); setRuntime({ ready: false, pumpReady: false, missing: [], stonkBlockers: ["Availability check failed. Retry above."], pumpBlockers: ["Availability check failed. Retry above."] }); }
    finally { setBusy(false); }
  }

  function requestHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  async function previewImage(file: File | undefined) {
    const readId = ++imageReadId.current;
    setLogo(""); setImageName(""); setError(""); setImageLoading(Boolean(file));
    if (!file) return;
    try {
      validateTokenImage(file);
      const data = await toDataUrl(file);
      if (readId !== imageReadId.current) return;
      setLogo(data); setImageName(file.name);
    } catch (caught) {
      if (readId === imageReadId.current) setError(caught instanceof Error ? caught.message : "Could not read image. Choose it again.");
    } finally { if (readId === imageReadId.current) setImageLoading(false); }
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
    if (!receipt || failure || autoCheckPaused) return;
    if (!busy) void checkStatus();
    const timer = window.setInterval(() => { void checkStatus(true); }, 8_000);
    return () => window.clearInterval(timer);
  // checkStatus deliberately follows the current receipt value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.launchId, receipt?.paymentSignature, failure, autoCheckPaused]);

  useEffect(() => {
    if (!prepared || receipt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [prepared, receipt]);

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
    if (busy || prepared || receipt) return;
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
      const { response, body } = await clientJson("/api/launch/prepare", { method: "POST", headers: requestHeaders(), body: JSON.stringify(payload) }, 70_000, "Preparation timed out. No wallet signature was requested. Your details are still here; try preparing again.");
      if (!response.ok) throw new Error(body.error ?? "Could not prepare launch");
      setPrepared({ ...body, logo, review: { venue, quoteSymbol: payload.quoteSymbol, name: String(payload.name), symbol: String(payload.symbol).toUpperCase(), allocation: { ...allocation }, creatorShare: { ...creatorShare } } });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare launch"); }
    finally { setBusy(false); }
  }

  function complete(body: LaunchStatus) {
    if (body.status === "failed") {
      setFailure({ message: body.failureMessage ?? "Launch failed. Check status to verify the saved transaction before trying again.", retrySafe: body.retrySafe === true });
      setError("");
      return;
    }
    if (body.status !== "completed") { setError(""); return; }
    setFailure(null);
    setResult({ mint: String(body.mint), pool: String(body.pool), signature: String(body.signature ?? body.paymentSignature), trackerStatus: String(body.trackerStatus ?? "pending") });
    setPrepared(null);
    if (body.trackerStatus === "active") {
      setReceipt(null);
      try { localStorage.removeItem(receiptKey); } catch { /* No signing depends on storage. */ }
    }
  }

  async function checkStatus(quiet = false) {
    if (!receipt || statusRequest.current) return;
    statusRequest.current = true;
    setCheckingStatus(true);
    if (!quiet) setError("");
    try {
      const { response, body } = await clientJson(`/api/launch/status/${encodeURIComponent(receipt.paymentSignature)}?launchId=${encodeURIComponent(receipt.launchId)}`, { cache: "no-store" }, 20_000, "Status check timed out. Your receipt is safe. Try Check launch status again; do not make another payment.");
      if (receiptRef.current?.paymentSignature !== receipt.paymentSignature) return;
      if (!response.ok) throw new Error(body.error ?? "Could not verify payment status. Keep this receipt and do not pay again.");
      complete(body);
      setAutoCheckPaused(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Status check failed"); setAutoCheckPaused(true); }
    finally { statusRequest.current = false; setCheckingStatus(false); }
  }

  function startFreshReview() {
    if (!receipt || !failure?.retrySafe || busy || statusRequest.current) return;
    try {
      // Archive public identifiers before clearing the pending pointer. The
      // immutable server receipt and creator history remain available too.
      localStorage.setItem(`${receiptKey}-archive-${receipt.launchId}`, JSON.stringify(receipt));
      localStorage.removeItem(receiptKey);
    } catch { setError("Could not save your receipt. Keep a copy and allow browser storage before starting again."); return; }
    receiptRef.current = null;
    setReceipt(null); setFailure(null); setPrepared(null); setResult(null); setError(""); setAutoCheckPaused(false);
    mintSigner.current = null;
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
      const { response, body } = await clientJson("/api/launch/submit", { method: "POST", headers: requestHeaders(), body: JSON.stringify({ launchId: prepared.launchId, signedQuote: prepared.signedQuote, signedTransaction: encodeBase64(signedTransaction), logo: prepared.logo }) }, 70_000, "Submission response timed out. Your transaction may still land. Use Check launch status with the saved receipt; do not pay again.");
      if (!response.ok) throw new Error(body.error ?? "Could not confirm launch submission. Check status before taking any further action.");
      complete(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Launch failed"); }
    finally { setBusy(false); }
  }

  const walletPicker = !wallet && <div className="wallet-picker"><select aria-label="Wallet" disabled={busy} value={selectedWallet} onChange={(event) => setSelectedWallet(event.target.value)}>{wallets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button className="button button-secondary" type="button" disabled={busy} onClick={() => void connect().catch((caught) => setError(caught instanceof Error ? caught.message : "Wallet connection failed"))}>Connect wallet</button></div>;

  return (
    <form className={`panel launch-form venue-theme-${venue}`} onSubmit={(event) => { event.preventDefault(); void prepare(new FormData(event.currentTarget)); }}>
      {receipt && <section className="panel launch-recovery" aria-label="Recover your previous launch" aria-busy={checkingStatus}>
        <div className="section-label">Previous launch receipt</div>
        <h3>{failure ? "Launch did not complete" : result ? "Token launched. Tracking recovery pending" : "Checking your previous launch"}</h3>
        <p className="notice">{failure?.message ?? "The token form is locked to prevent a duplicate payment. Recover your previous launch here first. No wallet connection is needed to check it."}</p>
        <div className="recovery-actions"><button type="button" className="button" disabled={checkingStatus} onClick={() => void checkStatus()}>{checkingStatus ? "Checking saved receipt..." : "Check launch status"}</button>{failure?.retrySafe && <button type="button" className="button button-secondary" disabled={busy || checkingStatus} onClick={startFreshReview}>Save receipt and start a fresh review</button>}</div>
        {checkingStatus && <p className="notice" role="status">Checking may take up to 20 seconds. Your wallet will not open.</p>}
        <details><summary>View saved receipt</summary><p className="mono">Launch: {receipt.launchId}<br />Transaction: <a href={`https://solscan.io/tx/${encodeURIComponent(receipt.paymentSignature)}`} target="_blank" rel="noreferrer">{receipt.paymentSignature}</a></p></details>
      </section>}
      {error && <div className="error" role="alert">{error}</div>}
      {testMode && <section className="form-section"><div className="section-label">Test with your own wallet</div><p className="notice">1. Connect wallet. 2. Choose your venue and token details. 3. Review the cost and approve in your wallet.</p><p className="notice">Real mainnet costs. Hidden on TopBlast, not private onchain or at the venue. No token is created until you approve the reviewed transaction. Reward payouts remain separately gated.</p>{walletPicker}{wallet && <p className="notice">Connected: <span className="mono">{wallet.address}</span></p>}<p className="notice" role="status">{!runtime ? "Checking test availability..." : venueReady ? "Test launch available. No access token required." : "Testing unavailable. Check the message below or retry."}</p><button type="button" className="button button-secondary" disabled={busy || Boolean(prepared)} onClick={() => void checkTestAccess()}>Refresh test availability</button></section>}
      {runtime && !venueReady && <div className="error"><strong>{venue === "pumpfun" ? "Pump.fun unavailable." : "StonkFun unavailable."}</strong> The transaction button stays locked until infrastructure checks pass. No payment can be submitted here.<ul>{(venue === "pumpfun" ? runtime.pumpBlockers : runtime.stonkBlockers ?? []).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      <fieldset disabled={busy || Boolean(prepared) || Boolean(receipt)}>
      <div className="launch-venue-hint"><VenueBadge venue={venue} /><span>{venue === "pumpfun" ? "SOL pair · WSOL rewards" : "STONK pair · STONK rewards"}</span></div>
      <div className="form-grid">
        <div className="field full"><label htmlFor="venue">Launch venue</label><select id="venue" value={venue} onChange={(event) => setVenue(event.target.value as typeof venue)}><option value="stonkfun">StonkFun · STONK pair</option><option value="pumpfun">Pump.fun · SOL pair</option></select>{venue === "pumpfun" && <p className="notice">Regular Pump.fun token with TopBlast deposit-funded rewards paid in WSOL. Pump.fun native holder rewards are separate and are not enabled. Tracking pauses at graduation until the new market is verified.</p>}</div>
        <div className="field"><label htmlFor="name">Token name</label><input id="name" name="name" required maxLength={32} placeholder="Top Coin" /></div>
        <div className="field"><label htmlFor="symbol">Ticker</label><input id="symbol" name="symbol" required maxLength={10} placeholder="TOP" /></div>
        <div className="field full"><label htmlFor="description">Description</label><textarea id="description" name="description" maxLength={500} placeholder="What this token is for." /></div>
        <div className="field full"><label htmlFor="image">Image</label><input id="image" name="image" type="file" required accept="image/png,image/jpeg,image/webp" onChange={(event) => { void previewImage(event.target.files?.[0]); }} /><p className="notice">PNG, JPEG or WebP. Up to 2 MB.</p>{imageLoading && <p className="notice" role="status">Loading image preview...</p>}{logo && <figure className="token-image-preview"><Image src={logo} alt="Selected token image preview" width={120} height={120} unoptimized /><figcaption><strong>Token image preview</strong><span>{imageName}</span><small>This image will be included in your launch.</small></figcaption></figure>}</div>
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
        <p className="notice"><strong>Split 100% of your share.</strong> These controls divide your {CREATOR_REWARD_PERCENT}% share, not the gross funding amount.</p>
        <div className="allocation-grid allocation-grid-two">
          {(["topblastPercent", "creatorPercent"] as const).map((key) => (
            <label className="allocation" key={key}>
              <span className="section-label">{key === "topblastPercent" ? "TopBlast rewards" : "Creator"}</span>
              <output className="allocation-percent">{creatorShare[key]}%</output>
              <input aria-label={key === "topblastPercent" ? "Adjust TopBlast rewards" : "Adjust creator share"} aria-valuetext={`${creatorShare[key]}% of your share`} type="range" min="0" max="100" step={CREATOR_SHARE_STEP} value={creatorShare[key]} onChange={(event) => setCreatorShare(updateCreatorShare(key, Number(event.target.value)))} />
            </label>
          ))}
        </div>
        <p className="notice">Your share total: {creatorShare.topblastPercent + creatorShare.creatorPercent}%. Adjust in {CREATOR_SHARE_STEP}-point steps. Protocol receives a fixed {FIXED_PROTOCOL_PERCENT}% of gross funding before your share is split. <a href="/docs#funding">How funding works</a>.</p>
      </div>
      </fieldset>
      {prepared && !receipt && (
        <div className="panel" style={{ background: "#fff5d7" }}>
          <div className="section-label">Transaction review</div>
          <div className="token-venue"><VenueBadge venue={prepared.review.venue} /></div>
          {testMode && <p className="notice"><strong>TEST LAUNCH · HIDDEN FROM PUBLIC TOPBLAST PAGES</strong><br />This is a real Solana mainnet transaction, not a simulation-only launch.</p>}
          <h3>{prepared.review.name} · ${prepared.review.symbol}</h3>
          <Image src={prepared.logo} alt="Token image included in this launch" width={96} height={96} className="review-token-image" unoptimized />
          <p className="notice">Venue: {prepared.review.venue === "pumpfun" ? "Pump.fun" : "StonkFun"}. Pair: {prepared.review.symbol} / {prepared.review.quoteSymbol}. Your share: {prepared.review.creatorShare.topblastPercent}% rewards / {prepared.review.creatorShare.creatorPercent}% creator.</p>
          <p className="notice">Overall funding allocation: {prepared.review.allocation.topblastPercent}% rewards, {prepared.review.allocation.creatorPercent}% creator retained, {prepared.review.allocation.protocolPercent}% protocol. Your two controls divide the remaining {CREATOR_REWARD_PERCENT}%, not 100% of gross funding.</p>
          {prepared.review.venue === "pumpfun" && <p className="notice">Shown SOL cost is the simulated debit for network fees and account creation. No initial buy. Creator fees follow Pump.fun’s schedule. TopBlast rewards require a separate creator deposit.</p>}
          {prepared.raw?.creationMethod === "stonk_launchlab" && <p className="notice">StonkFun standard launch through its published LaunchLab configuration. Shown SOL cost covers simulated network fees and account rent, not an initial buy or reward funding. Stonk’s token listing may take time to appear.</p>}
          {prepared.raw?.venueFees && <p className="notice">Venue trading fees: {((Number(prepared.raw.venueFees.protocolRate) + Number(prepared.raw.venueFees.platformRate) + Number(prepared.raw.venueFees.creatorRate)) / Number(prepared.raw.venueFees.denominator) * 100).toFixed(2)}% total, including {(Number(prepared.raw.venueFees.creatorRate) / Number(prepared.raw.venueFees.denominator) * 100).toFixed(2)}% creator fee. These are separate from the TopBlast deposit allocation.</p>}
          <p className="notice">Network: Solana mainnet. Fee payer: <span className="mono">{wallet?.address}</span>. Estimated SOL debit: {prepared.payment.sol ?? prepared.payment.lamports ?? "See wallet"} {prepared.payment.sol !== undefined ? "SOL" : "lamports"}. Launch program: <span className="mono">{prepared.payment.recipient ?? "Shown by your wallet"}</span>.</p>
          <p className="notice">{prepared.expiresAt && new Date(prepared.expiresAt).getTime() <= now ? "Review expired. Prepare a fresh review before signing." : `Estimated signing window: ${prepared.expiresAt ? Math.max(0, Math.ceil((new Date(prepared.expiresAt).getTime() - now) / 1000)) + " seconds" : "limited"}. Review now, then approve promptly in your wallet. Solana block height determines actual expiry.`}</p>
          <button type="button" className="button" disabled={busy || Boolean(prepared.expiresAt && new Date(prepared.expiresAt).getTime() <= now)} onClick={signAndSubmit}>Confirm in wallet</button> <button type="button" className="button button-secondary" disabled={busy} onClick={() => setPrepared(null)}>Edit / refresh review</button>
        </div>
      )}
      {result && <div className={result.trackerStatus === "active" ? "success" : "error"}><strong>{result.trackerStatus === "active" ? "Launch complete. TopBlast tracking active." : "Token launched. Tracker registration needs recovery."}</strong><br />Mint: {result.mint}<br />Pool: {result.pool}<br />Signature: {result.signature}{result.trackerStatus !== "active" && <><br />Use the saved payment status recovery to retry tracking. No second payment is required.</>}</div>}
      <div className="form-footer">
        <p className="notice">Your wallet signs the reviewed launch transaction. TopBlast never receives your private key.</p>
        {!prepared && !receipt && !result && <button className="button venue-button" disabled={busy || imageLoading || total !== 100 || !venueReady}>{busy ? "Preparing..." : !runtime ? "Checking availability..." : !venueReady ? "Temporarily unavailable" : wallet ? venue === "pumpfun" ? "Launch on Pump.fun" : "Launch on STONK" : "Connect and launch"}</button>}
      </div>
      {!testMode && walletPicker}
      {wallet && <p className="notice">Connected: {walletName} · <span className="mono">{wallet.address}</span></p>}
    </form>
  );
}
