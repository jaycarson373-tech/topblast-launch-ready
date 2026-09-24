"use client";

import { useEffect, useMemo, useRef, useState, type InvalidEvent } from "react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import { getWallets } from "@wallet-standard/app";
import { VenueBadge } from "@/components/venue-badge";
import Image from "next/image";
import { initialCreatorShare, updateCreatorShare, creatorShareToAllocation, CREATOR_SHARE_STEP, EPOCH_RELEASE_PERCENT } from "@/lib/launch-allocation";
import { validateTokenImage } from "@/lib/token-image";
import { clientJson } from "@/lib/client-json";
import { PairPicker, type PairOption } from "@/components/pair-picker";
import type { DevBuyReview } from "@/lib/solana/dev-buy";
import { formatTokenAtoms } from "@/lib/token-display";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STONK_DEFAULT_QUOTE_MINT = process.env.NEXT_PUBLIC_STONK_QUOTE_MINT ?? SOL_MINT;
const STONK_PAIR: PairOption = { mint: STONK_DEFAULT_QUOTE_MINT, symbol: STONK_DEFAULT_QUOTE_MINT === SOL_MINT ? "SOL" : "STONK", name: STONK_DEFAULT_QUOTE_MINT === SOL_MINT ? "Solana" : "STONK", decimals: 9, launchable: true, launchLabReady: true };
const PUMP_SOL_PAIR: PairOption = { mint: SOL_MINT, symbol: "SOL", name: "Solana", decimals: 9, launchable: true };

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
  rewardTreasury?: string;
  protocolTreasury?: string;
  raw?: { devBuy?: DevBuyReview; mintSignerRequired?: boolean; creationMethod?: string; feeRecipient?: string; receiverId?: string; venueFees?: { denominator: string; protocolRate: string; platformRate: string; creatorRate: string } };
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

export function LaunchForm({ testMode = false, publicTestListing = false }: { testMode?: boolean; publicTestListing?: boolean }) {
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
  const [stonkPairs, setStonkPairs] = useState<PairOption[]>([STONK_PAIR]);
  const [stonkPairMint, setStonkPairMint] = useState(STONK_DEFAULT_QUOTE_MINT);
  const [pumpPairs, setPumpPairs] = useState<PairOption[]>([PUMP_SOL_PAIR]);
  const [pumpPairMint, setPumpPairMint] = useState(SOL_MINT);
  const [pairError, setPairError] = useState("");
  const [devBuyAmount, setDevBuyAmount] = useState("");
  const venueReady = Boolean(venue === "stonkfun" ? runtime?.ready : runtime?.pumpReady);
  const total = useMemo(() => allocation.topblastPercent + allocation.creatorPercent + allocation.protocolPercent, [allocation]);
  const stonkPair = stonkPairs.find((pair) => pair.mint === stonkPairMint) ?? STONK_PAIR;
  const pumpPair = pumpPairs.find((pair) => pair.mint === pumpPairMint) ?? PUMP_SOL_PAIR;
  const selectedPair = venue === "pumpfun" ? pumpPair : stonkPair;
  useEffect(() => { setDevBuyAmount(""); }, [venue, selectedPair.mint]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(receiptKey);
      if (saved) { const parsed = JSON.parse(saved); if (typeof parsed.launchId === "string" && typeof parsed.paymentSignature === "string") setReceipt(parsed); }
    } catch { /* Storage may be unavailable; in-memory state still prevents resubmission. */ }
    clientJson(testMode ? "/api/launch/test-readiness" : "/api/health", { cache: "no-store" }, 25_000, "Launch availability check timed out")
      .then(({ response, body }) => { if (!response.ok && !(response.status === 503 && typeof body.launchReady === "boolean")) throw new Error(body.error ?? "Launch availability check failed"); return body; })
      .then((body) => setRuntime(testMode ? body : { ready: body.venues?.stonkfun ? body.venues.stonkfun.launchReady === true : body.ready === true, stonkBlockers: body.venues?.stonkfun?.blockers ?? [], missing: body.missing ?? [], pumpReady: body.venues?.pumpfun?.launchReady === true, pumpBlockers: body.venues?.pumpfun?.blockers ?? ["Pump.fun readiness has not been verified"] }))
      .catch((caught) => { if (testMode) setError(caught instanceof Error ? caught.message : "Test availability check failed"); setRuntime({ ready: false, missing: ["runtime health check"], stonkBlockers: ["Test or infrastructure checks unavailable"], pumpReady: false, pumpBlockers: ["Runtime health check unavailable"] }); });
  }, [receiptKey, testMode]);

  useEffect(() => {
    clientJson("/api/venues/stonkfun/pairs", { cache: "no-store" }, 20_000, "StonkFun pair list timed out")
      .then(({ response, body }) => {
        if (!response.ok || !Array.isArray(body.pairs)) throw new Error(body.error ?? "StonkFun pair list is unavailable");
        const pairs = (body.pairs as PairOption[]).filter((pair) => pair.launchable && pair.launchLabReady !== false);
        if (!pairs.length) throw new Error("StonkFun returned no launchable pairs");
        setStonkPairs(pairs);
        setStonkPairMint((current) => pairs.some((pair) => pair.mint === current) ? current : pairs[0].mint);
        setPairError("");
      })
      .catch((caught) => setPairError(caught instanceof Error ? caught.message : "StonkFun pair list is unavailable"));
  }, []);

  useEffect(() => {
    clientJson("/api/venues/pumpfun/pairs", { cache: "no-store" }, 20_000, "Pump.fun pair list timed out")
      .then(({ response, body }) => {
        if (!response.ok || !Array.isArray(body.pairs)) throw new Error(body.error ?? "Pump.fun pair list is unavailable");
        const pairs = (body.pairs as PairOption[]).filter((pair) => pair.launchable);
        if (!pairs.length) throw new Error("Pump.fun returned no supported pairs");
        setPumpPairs(pairs);
        setPumpPairMint((current) => pairs.some((pair) => pair.mint === current) ? current : pairs[0].mint);
      })
      .catch(() => { /* Keep the verified SOL fallback; prepare revalidates it server-side. */ });
  }, []);

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
    const refresh = () => {
      // Some extensions register the same wallet through more than one
      // discovery bridge. Keep one launch button per visible wallet name.
      const discovered = registry.get() as readonly WalletLike[];
      const unique = [...new Map(discovered
        .filter((item) => item.features["standard:connect"] && item.features["solana:signTransaction"])
        .map((item) => [item.name, item])).values()];
      setWallets(unique);
      setSelectedWallet((current) => unique.some((item) => item.name === current) ? current : unique[0]?.name || "");
    };
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

  async function connect(requestedWallet?: string) {
    setError("");
    const choice = requestedWallet || selectedWallet || wallets[0]?.name;
    const candidate = wallets.find((item) => item.name === choice && item.features["standard:connect"] && item.features["solana:signTransaction"]);
    if (!candidate) throw new Error("Install a Wallet Standard Solana wallet to continue");
    const response = await (candidate.features["standard:connect"] as ConnectFeature).connect();
    const account = response.accounts.find((item) => item.chains.includes("solana:mainnet"));
    if (!account) throw new Error("This launch requires a wallet account that supports Solana mainnet");
    setSelectedWallet(candidate.name); setWallet(account); setWalletName(candidate.name); setWalletObject(candidate);
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
        quoteMint: selectedPair.mint, quoteSymbol: selectedPair.symbol, feeTier: form.get("feeTier") ?? "1%", allocation,
        devBuyAmount: devBuyAmount.trim() || "0",
        website: form.get("website"), twitter: form.get("twitter"), telegram: form.get("telegram"),
      };
      const { response, body } = await clientJson("/api/launch/prepare", { method: "POST", headers: requestHeaders(), body: JSON.stringify(payload) }, 70_000, "Preparation timed out. No wallet signature was requested. Your details are still here; try preparing again.");
      if (!response.ok) throw new Error(body.error ?? "Could not prepare launch");
      setPrepared({ ...body, logo, review: { venue, quoteSymbol: payload.quoteSymbol, name: String(payload.name), symbol: String(payload.symbol).toUpperCase(), allocation: { ...allocation }, creatorShare: { ...creatorShare } } });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare launch"); }
    finally { setBusy(false); }
  }

  function explainInvalidField(event: InvalidEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const label = target.labels?.[0]?.textContent?.trim() || target.name || "required field";
    setError(`Complete ${label} before reviewing the launch.`);
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
        const tx = VersionedTransaction.deserialize(bytes);
        tx.sign([mintSigner.current]);
        bytes = new Uint8Array(tx.serialize());
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

  const walletPicker = !wallet && <div className="wallet-picker" aria-label="Choose a wallet">{wallets.length ? wallets.map((item) => <button key={item.name} className="wallet-choice" type="button" disabled={busy} onClick={() => void connect(item.name).catch((caught) => setError(caught instanceof Error ? caught.message : "Wallet connection failed"))}>Connect {item.name}</button>) : <span className="notice">Install a Solana wallet to continue.</span>}</div>;

  return (
    <form className={`panel launch-form venue-theme-${venue}`} onInvalid={explainInvalidField} onSubmit={(event) => { event.preventDefault(); void prepare(new FormData(event.currentTarget)); }}>
      {receipt && !result && <section className="panel launch-recovery" aria-label="Recover your previous launch" aria-busy={checkingStatus}>
        <div className="section-label">Previous launch receipt</div>
        <h3>{failure ? "Launch did not complete" : result ? "Token launched. Tracking recovery pending" : "Checking your previous launch"}</h3>
        <p className="notice">{failure?.message ?? "The token form is locked to prevent a duplicate payment. Recover your previous launch here first. No wallet connection is needed to check it."}</p>
        <div className="recovery-actions"><button type="button" className="button" disabled={checkingStatus} onClick={() => void checkStatus()}>{checkingStatus ? "Verifying launch receipt..." : "Refresh launch receipt"}</button>{failure?.retrySafe && <button type="button" className="button button-secondary" disabled={busy || checkingStatus} onClick={startFreshReview}>Save receipt and start a fresh review</button>}</div>
        {checkingStatus && <p className="notice" role="status">Checking may take up to 20 seconds. Your wallet will not open.</p>}
        <details><summary>View saved receipt</summary><p className="mono">Launch: {receipt.launchId}<br />Transaction: <a href={`https://solscan.io/tx/${encodeURIComponent(receipt.paymentSignature)}`} target="_blank" rel="noreferrer">{receipt.paymentSignature}</a></p></details>
      </section>}
      {error && <div className="error" role="alert">{error}</div>}
      {testMode && <section className="form-section"><div className="section-label">Connect your creator wallet</div><p className="notice">1. Connect wallet. 2. Choose your venue and token details. 3. Review the cost and approve in your wallet.</p><p className="notice">Real mainnet costs. {publicTestListing ? "Publicly listed as a pre-launch verification token." : "Hidden on TopBlast."} Onchain and venue activity is public. No token is created until you approve the reviewed transaction.</p>{walletPicker}{wallet && <p className="notice">Connected: <span className="mono">{wallet.address}</span></p>}<p className="notice" role="status">{!runtime ? "Checking venue availability..." : venueReady ? "Venue ready." : "Venue unavailable. The transaction button remains locked."}</p></section>}
      {runtime && !venueReady && <div className="error"><strong>{venue === "pumpfun" ? "Pump.fun unavailable." : "StonkFun unavailable."}</strong> The transaction button stays locked until infrastructure checks pass. No payment can be submitted here.<ul>{(venue === "pumpfun" ? runtime.pumpBlockers : runtime.stonkBlockers ?? []).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      <fieldset disabled={busy || Boolean(prepared) || Boolean(receipt)}>
      <div className="launch-venue-hint"><VenueBadge venue={venue} /><span>{selectedPair.symbol} pair · {selectedPair.symbol} rewards</span></div>
      <div className="form-grid">
        <div className="field full"><label htmlFor="venue">Launch venue</label><select id="venue" value={venue} onChange={(event) => setVenue(event.target.value as typeof venue)}><option value="stonkfun">StonkFun · choose any live pair</option><option value="pumpfun">Pump.fun · choose an official supported pair</option></select>{venue === "pumpfun" && <p className="notice">Pump.fun custom pairs use the venue’s current official allowlist. Rewards use the selected quote asset. Arbitrary unapproved mints are rejected, and tracking pauses at unsupported graduation.</p>}</div>
        <div className="field"><label htmlFor="name">Token name</label><input id="name" name="name" required maxLength={32} placeholder="Top Coin" /></div>
        <div className="field"><label htmlFor="symbol">Ticker</label><input id="symbol" name="symbol" required maxLength={10} placeholder="TOP" /></div>
        <div className="field full"><label htmlFor="description">Description</label><textarea id="description" name="description" maxLength={500} placeholder="What this token is for." /></div>
        <div className="field full"><label htmlFor="image">Image</label><input id="image" name="image" type="file" required accept="image/png,image/jpeg,image/webp" onChange={(event) => { void previewImage(event.target.files?.[0]); }} /><p className="notice">PNG, JPEG or WebP. Up to 2 MB.</p>{imageLoading && <p className="notice" role="status">Loading image preview...</p>}{logo && <figure className="token-image-preview"><Image src={logo} alt="Selected token image preview" width={120} height={120} unoptimized /><figcaption><strong>Token image preview</strong><span>{imageName}</span><small>This image will be included in your launch.</small></figcaption></figure>}</div>
        <div className="field"><label htmlFor="twitter">X URL</label><input id="twitter" name="twitter" type="url" placeholder="https://x.com/..." /></div>
        <div className="field"><label htmlFor="website">Website URL</label><input id="website" name="website" type="url" placeholder="https://..." /></div>
        <div className="field"><label htmlFor="telegram">Telegram URL</label><input id="telegram" name="telegram" type="url" placeholder="https://t.me/..." /></div>
        {venue === "stonkfun" && <p className="notice">Created through StonkFun’s standard LaunchLab configuration. This launch gets its own TopBlast-controlled fee wallet. Stonk’s forwarding threshold still applies. Only funds received and transferred from that wallet can fund this token’s reward pool.</p>}
      </div>
      <div className="form-section">
        <div className="section-label">Pair</div>
        {venue === "stonkfun" ? <><PairPicker key="stonkfun-pairs" id="stonk-pair" label="StonkFun quote pair" venue="stonkfun" pairs={stonkPairs} value={stonkPairMint} onChange={setStonkPairMint} /><p className="notice">{stonkPairs.length} live StonkFun pairs. Search by ticker, name, or mint address. Rewards use the selected quote asset.</p>{pairError && <p className="error">{pairError}. SOL remains available while the catalog reconnects.</p>}</> : <><PairPicker key="pumpfun-pairs" id="pump-pair" label="Pump.fun quote pair" venue="pumpfun" pairs={pumpPairs} value={pumpPairMint} onChange={setPumpPairMint} /><p className="notice">{pumpPairs.length} official Pump.fun pairs. Search by ticker, name, or mint address. Rewards use the selected quote asset.</p></>}
      </div>
      <div className="form-section">
        <div className="field"><label htmlFor="devBuyAmount">Dev buy (optional) · {selectedPair.symbol}</label><input id="devBuyAmount" name="devBuyAmount" inputMode="decimal" maxLength={60} placeholder="0" value={devBuyAmount} onChange={(event) => setDevBuyAmount(event.target.value)} pattern="[0-9]+(\.[0-9]+)?" aria-describedby="dev-buy-help" /></div>
        <p className="notice" id="dev-buy-help">Maximum {selectedPair.symbol} to spend on your first purchase, including trading fees. Tokens go directly to your connected creator wallet. Launch and buy complete together or neither completes. Leave blank for no buy. {venue === "stonkfun" && selectedPair.mint === SOL_MINT ? "The transaction wraps this SOL amount into WSOL for Stonk." : selectedPair.mint !== SOL_MINT ? `Your wallet must already hold ${selectedPair.symbol}; network fees and rent are additional SOL.` : "Network fees and rent are additional SOL."}</p>
      </div>
      <div className="form-section">
        <div className="section-label">TopBlast rewards</div>
        <h3>Fund the blast zone.</h3>
        <p className="notice">Eligible holders below their verified average entry can share this launch’s funded reward pool. Pump uses per-mint fee sharing; new Stonk launches use separate fee wallets. The worker applies your split only to confirmed funding. Unfunded rewards are never allocated.</p>
        <p className="notice"><strong>Choose where your distributable fees go.</strong> Holder rewards and Creator always add to 100%.</p>
        <label className="fee-share-control">
          <span className="fee-share-values"><strong><small>Holder rewards</small>{creatorShare.topblastPercent}%</strong><strong><small>Creator</small>{creatorShare.creatorPercent}%</strong></span>
          <input aria-label="Adjust holder rewards fee share" aria-valuetext={`${creatorShare.topblastPercent}% holder rewards and ${creatorShare.creatorPercent}% creator`} type="range" min="0" max="100" step={CREATOR_SHARE_STEP} value={creatorShare.topblastPercent} onChange={(event) => setCreatorShare(updateCreatorShare("topblastPercent", Number(event.target.value)))} />
          <span className="fee-share-scale"><span>More to creator</span><span>More to holders</span></span>
        </label>
        <p className="notice">You only choose the holder / creator split shown above. It always totals 100%. <a href="/docs#funding">Full funding and protocol accounting</a>.</p>
        <p className="notice"><strong>Carry-forward policy:</strong> each epoch can reserve {EPOCH_RELEASE_PERCENT}% of the currently available holder-reward balance. The remaining {100 - EPOCH_RELEASE_PERCENT}% stays isolated in this launch for later epochs.</p>
      </div>
      </fieldset>
      {prepared && !receipt && (
        <div className="panel" style={{ background: "#fff5d7" }}>
          <div className="section-label">Transaction review</div>
          <div className="token-venue"><VenueBadge venue={prepared.review.venue} /></div>
          {testMode && <p className="notice"><strong>PRE-LAUNCH VERIFICATION · {publicTestListing ? "PUBLICLY LISTED" : "HIDDEN FROM PUBLIC TOPBLAST PAGES"}</strong><br />This is a real Solana mainnet transaction, not a simulation-only launch.</p>}
          <h3>{prepared.review.name} · ${prepared.review.symbol}</h3>
          <Image src={prepared.logo} alt="Token image included in this launch" width={96} height={96} className="review-token-image" unoptimized />
          <p className="notice">Venue: {prepared.review.venue === "pumpfun" ? "Pump.fun" : "StonkFun"}. Pair: {prepared.review.symbol} / {prepared.review.quoteSymbol}. Selected split: {prepared.review.creatorShare.topblastPercent}% rewards / {prepared.review.creatorShare.creatorPercent}% creator.</p>
          <p className="notice">Your selected fee split: <strong>{prepared.review.creatorShare.topblastPercent}% holder rewards / {prepared.review.creatorShare.creatorPercent}% creator.</strong> These are the only allocation percentages shown in the launch flow, and they total 100%.</p>
          <p className="notice">Epoch release: {EPOCH_RELEASE_PERCENT}% of the available holder-reward balance is reserved for each eligible epoch. {100 - EPOCH_RELEASE_PERCENT}% carries forward inside this launch. No funded balance means no payout.</p>
          <p className="notice">Reward asset: {prepared.review.quoteSymbol}. Reward treasury: <span className="mono">{prepared.rewardTreasury ?? "Unavailable. Do not approve until verified."}</span>. Protocol treasury: <span className="mono">{prepared.protocolTreasury ?? "Unavailable. Do not approve until verified."}</span>.</p>
          {prepared.raw?.devBuy ? <div className="notice"><strong>Dev buy: up to {prepared.raw.devBuy.amount} {prepared.review.quoteSymbol}</strong><p>Recipient: <span className="mono">{prepared.raw.devBuy.recipient}</span><br />Minimum received: {formatTokenAtoms(prepared.raw.devBuy.minimumTokenAtoms, prepared.raw.devBuy.tokenDecimals)} ${prepared.review.symbol}. The quote-asset cap includes trading fees; SOL network fees and rent are additional. This purchase is not reward-pool funding.</p></div> : <p className="notice">Dev buy: none.</p>}
          <p className="notice"><strong>Permanent configuration:</strong> the selected holder / creator split and token metadata are fixed at launch. {prepared.review.venue === "stonkfun" ? "The onchain creator-fee recipient is this token’s dedicated TopBlast wallet. The worker transfers confirmed funding into this launch’s ledger before sending creator and eligible-holder payouts. Stonk’s forwarding threshold still applies." : "Pump is beta. After creation, the worker locks this mint to Pump.fun’s official per-mint fee-sharing config. Only finalized distributions for this mint fund rewards. Optional atomic dev buy. No cashback, mayhem, or PumpSwap graduation support."}</p>
          {prepared.raw?.receiverId && <p className="notice">Dedicated fee wallet: <span className="mono">{prepared.raw.feeRecipient}</span>. TopBlast supplies a one-time 0.01 SOL operating top-up after finalization. This is gas, not reward funding. Funds sent to this dedicated wallet are attributed only to this launch.</p>}
          <p className="notice">Shown SOL debit includes fees, rent and any SOL-funded dev buy. A non-SOL dev buy additionally spends the selected quote asset shown above. Nothing here is a reward-pool deposit.</p>
          {prepared.raw?.venueFees && <p className="notice">Venue trading fees: {((Number(prepared.raw.venueFees.protocolRate) + Number(prepared.raw.venueFees.platformRate) + Number(prepared.raw.venueFees.creatorRate)) / Number(prepared.raw.venueFees.denominator) * 100).toFixed(2)}% total, including {(Number(prepared.raw.venueFees.creatorRate) / Number(prepared.raw.venueFees.denominator) * 100).toFixed(2)}% creator fee. For Stonk launches, the selected holder / creator split applies to each verified creator-fee transfer received by the launch treasury.</p>}
          <p className="notice">Network: Solana mainnet. Fee payer: <span className="mono">{wallet?.address}</span>. Estimated SOL debit: {prepared.payment.sol ?? prepared.payment.lamports ?? "See wallet"} {prepared.payment.sol !== undefined ? "SOL" : "lamports"}. Launch program: <span className="mono">{prepared.payment.recipient ?? "Shown by your wallet"}</span>.</p>
          <p className="notice">{prepared.expiresAt && new Date(prepared.expiresAt).getTime() <= now ? "Review expired. Prepare a fresh review before signing." : `Estimated signing window: ${prepared.expiresAt ? Math.max(0, Math.ceil((new Date(prepared.expiresAt).getTime() - now) / 1000)) + " seconds" : "limited"}. Review now, then approve promptly in your wallet. Solana block height determines actual expiry.`}</p>
          <button type="button" className="button" disabled={busy || Boolean(prepared.expiresAt && new Date(prepared.expiresAt).getTime() <= now)} onClick={signAndSubmit}>Confirm in wallet</button> <button type="button" className="button button-secondary" disabled={busy} onClick={() => setPrepared(null)}>Edit / refresh review</button>
        </div>
      )}
      {result && <section className="success" aria-live="polite"><div className="section-label">LAUNCHED</div><h3>{result.trackerStatus === "active" ? "Your TopBlast page is live." : "Your token is live. TopBlast is activating."}</h3><p className="notice">Mint: <span className="mono">{result.mint}</span><br />Market: <span className="mono">{result.pool}</span><br />Transaction: <a href={`https://solscan.io/tx/${encodeURIComponent(result.signature)}`} target="_blank" rel="noreferrer">View on Solscan ↗</a></p><div className="hero-actions">{result.mint && (!testMode || publicTestListing) && <a className="button" href={`/token/${result.mint}`}>View token on TopBlast</a>}<a className="button button-secondary" href="/creator">Open creator dashboard</a></div>{result.trackerStatus !== "active" && <p className="notice">The venue launch is confirmed. TopBlast is retrying market registration automatically. No second payment is needed.</p>}{testMode && !publicTestListing && <p className="notice">This controlled launch is hidden from public TopBlast pages. Its creator record and onchain transaction remain available.</p>}</section>}
      <div className="form-footer">
        <p className="notice">Your wallet signs the reviewed launch transaction. TopBlast never receives your private key.</p>
        {!prepared && !receipt && !result && (wallet
          ? <button type="submit" className="button venue-button" disabled={busy || imageLoading || total !== 100 || !venueReady}>{busy ? "Preparing launch..." : !runtime ? "Checking availability..." : !venueReady ? "Temporarily unavailable" : venue === "pumpfun" ? "Launch on Pump.fun" : "Launch on STONK"}</button>
          : <button type="button" className="button venue-button" disabled={busy || !venueReady} onClick={() => void connect().catch((caught) => setError(caught instanceof Error ? caught.message : "Wallet connection failed"))}>{busy ? "Connecting..." : !runtime ? "Checking availability..." : !venueReady ? "Temporarily unavailable" : "Connect wallet"}</button>)}
      </div>
      {!testMode && walletPicker}
      {wallet && <p className="notice">Connected: {walletName} · <span className="mono">{wallet.address}</span></p>}
    </form>
  );
}
