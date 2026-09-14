"use client";

import { useEffect, useMemo, useState } from "react";
import { getWallets } from "@wallet-standard/app";

const STONK_MINT = process.env.NEXT_PUBLIC_STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";

interface WalletAccountLike { address: string; chains: readonly string[] }
interface WalletLike {
  name: string;
  accounts: readonly WalletAccountLike[];
  features: Record<string, unknown>;
}
interface ConnectFeature { connect(): Promise<{ accounts: readonly WalletAccountLike[] }> }
interface SignTransactionFeature {
  signTransaction(input: { account: WalletAccountLike; transaction: Uint8Array; chain: string }): Promise<readonly { signedTransaction: Uint8Array }[]>;
}
interface Prepared {
  launchId: string;
  signedQuote: string;
  paymentTransaction: string;
  payment: { lamports?: string | number; sol?: string | number; recipient?: string };
}

const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const encodeBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));

export function LaunchForm() {
  const [wallet, setWallet] = useState<WalletAccountLike | null>(null);
  const [walletName, setWalletName] = useState("");
  const [walletObject, setWalletObject] = useState<WalletLike | null>(null);
  const [allocation, setAllocation] = useState({ topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 });
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [runtime, setRuntime] = useState<{ ready: boolean; missing: string[] } | null>(null);
  const total = useMemo(() => allocation.topblastPercent + allocation.creatorPercent + allocation.protocolPercent, [allocation]);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setRuntime({ ready: Boolean(body.ready), missing: body.missing ?? [] }))
      .catch(() => setRuntime({ ready: false, missing: ["runtime health check"] }));
  }, []);

  async function connect() {
    setError("");
    const available = getWallets().get() as readonly WalletLike[];
    const candidate = available.find((item) => item.features["standard:connect"] && item.features["solana:signTransaction"]);
    if (!candidate) throw new Error("Install a Wallet Standard Solana wallet to continue");
    const response = await (candidate.features["standard:connect"] as ConnectFeature).connect();
    const account = response.accounts.find((item) => item.chains.some((chain) => chain.startsWith("solana:"))) ?? response.accounts[0];
    if (!account) throw new Error("The wallet did not expose a Solana account");
    setWallet(account); setWalletName(candidate.name); setWalletObject(candidate);
  }

  async function prepare(form: FormData) {
    setBusy(true); setError(""); setResult(null);
    try {
      const connected = wallet;
      if (!connected) { await connect(); throw new Error("Wallet connected. Review the form, then launch again."); }
      if (!logo) throw new Error("Choose a PNG, JPEG, or WebP image");
      if (total !== 100) throw new Error("Fee allocation must total 100%");
      const payload = {
        creatorWallet: connected.address,
        name: form.get("name"), symbol: form.get("symbol"), description: form.get("description"), logo,
        quoteMint: STONK_MINT, quoteSymbol: "STONK", feeTier: form.get("feeTier"), allocation,
        website: form.get("website"), twitter: form.get("twitter"), telegram: form.get("telegram"),
      };
      const response = await fetch("/api/launch/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not prepare launch");
      setPrepared(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare launch"); }
    finally { setBusy(false); }
  }

  async function signAndSubmit() {
    if (!prepared || !wallet || !walletObject) return;
    setBusy(true); setError("");
    try {
      const signer = walletObject.features["solana:signTransaction"] as SignTransactionFeature;
      const signed = await signer.signTransaction({ account: wallet, transaction: decodeBase64(prepared.paymentTransaction), chain: "solana:mainnet" });
      const signedTransaction = signed[0]?.signedTransaction;
      if (!signedTransaction) throw new Error("Wallet did not return a signed transaction");
      const response = await fetch("/api/launch/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ launchId: prepared.launchId, signedQuote: prepared.signedQuote, signedTransaction: encodeBase64(signedTransaction), logo }) });
      let body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Launch submission failed");
      if (body.status === "processing") {
        for (let attempt = 0; attempt < 24 && body.status === "processing"; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          const status = await fetch(`/api/launch/status/${encodeURIComponent(body.paymentSignature)}?launchId=${prepared.launchId}`, { cache: "no-store" });
          body = await status.json();
          if (!status.ok) throw new Error(body.error ?? "Launch status failed");
        }
      }
      if (body.status !== "completed") throw new Error("Launch is onchain and still processing. Do not submit another payment. Refresh status shortly.");
      setResult({ mint: String(body.mint), pool: String(body.pool), signature: String(body.signature ?? body.paymentSignature) });
      setPrepared(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Launch failed"); }
    finally { setBusy(false); }
  }

  return (
    <form className="panel" action={prepare}>
      {runtime && !runtime.ready && <div className="error"><strong>Launch activation pending.</strong> The transaction button stays locked until infrastructure checks pass. Missing: {runtime.missing.length ? runtime.missing.join(", ") : "LAUNCHES_ENABLED=true"}.</div>}
      <div className="form-grid">
        <div className="field"><label htmlFor="name">Token name</label><input id="name" name="name" required maxLength={32} placeholder="Top Coin" /></div>
        <div className="field"><label htmlFor="symbol">Ticker</label><input id="symbol" name="symbol" required maxLength={10} placeholder="TOP" /></div>
        <div className="field full"><label htmlFor="description">Description</label><textarea id="description" name="description" maxLength={500} placeholder="What this token is for." /></div>
        <div className="field full"><label htmlFor="image">Image</label><input id="image" name="image" type="file" required accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setError("Image must be 2 MB or smaller"); return; } setLogo(await toDataUrl(file)); }} /></div>
        <div className="field"><label htmlFor="twitter">X URL</label><input id="twitter" name="twitter" type="url" placeholder="https://x.com/..." /></div>
        <div className="field"><label htmlFor="website">Website URL</label><input id="website" name="website" type="url" placeholder="https://..." /></div>
        <div className="field"><label htmlFor="telegram">Telegram URL</label><input id="telegram" name="telegram" type="url" placeholder="https://t.me/..." /></div>
        <div className="field"><label htmlFor="feeTier">StonkFun pool fee</label><select id="feeTier" name="feeTier" defaultValue="1%"><option value="1%">1% pool, 0.5% creator share</option><option value="2%">2% pool, 1.5% creator share</option></select></div>
      </div>
      <div className="form-section">
        <div className="section-label">Pair</div>
        <h3>STONK</h3>
        <p className="notice mono">{STONK_MINT}</p>
      </div>
      <div className="form-section">
        <div className="section-label">TopBlast rewards</div>
        <h3>Fund the blast zone.</h3>
        <p className="notice">When eligible holders fall below their verified average entry, they share the funded TopBlast reward pool. Allocations apply only to creator-fee revenue made available to the platform.</p>
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
      {prepared && (
        <div className="panel" style={{ background: "#fff5d7" }}>
          <div className="section-label">Transaction review</div>
          <h3>Confirm StonkFun launch payment</h3>
          <p className="notice">Cluster: Solana mainnet. Fee payer: {wallet?.address}. Amount: {prepared.payment.sol ?? prepared.payment.lamports ?? "See wallet"} {prepared.payment.sol ? "SOL" : "lamports"}. Recipient: {prepared.payment.recipient ?? "Shown by your wallet"}.</p>
          <button type="button" className="button" disabled={busy} onClick={signAndSubmit}>Confirm in wallet</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {result && <div className="success"><strong>Launch complete.</strong><br />Mint: {result.mint}<br />Pool: {result.pool}<br />Signature: {result.signature}</div>}
      <div className="form-footer">
        <p className="notice">Non-custodial. Your wallet signs the exact StonkFun payment transaction. TopBlast never receives your private key.</p>
        {!prepared && <button className="button" disabled={busy || total !== 100 || !runtime?.ready}>{busy ? "Preparing..." : !runtime?.ready ? "Activation pending" : wallet ? "Launch on STONK" : "Connect and launch"}</button>}
      </div>
      {wallet && <p className="notice">Connected: {walletName} · <span className="mono">{wallet.address}</span></p>}
    </form>
  );
}
