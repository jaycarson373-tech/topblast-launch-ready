"use client";

import { useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";

interface Account { address: string; chains: readonly string[] }
interface Wallet { name: string; accounts: readonly Account[]; features: Record<string, unknown> }
interface Connect { connect(): Promise<{ accounts: readonly Account[] }> }
interface Sign { signTransaction(input: { account: Account; transaction: Uint8Array; chain: string }): Promise<readonly { signedTransaction: Uint8Array }[]> }
interface Events { on(event: "change", listener: (change: { accounts?: readonly Account[] }) => void): () => void }
interface FundingReview {
  intentId: string; unsignedTransaction: string; expiresAt: string; grossAmountAtoms: string;
  rewardAmountAtoms: string; creatorAmountAtoms: string; protocolAmountAtoms: string;
  rewardTreasury: string; protocolTreasury: string | null; assetMint: string; decimals: number;
}
const decode = (value: string) => Uint8Array.from(atob(value), (item) => item.charCodeAt(0));
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));

export function FundingPanel({ launchId, creatorWallet }: { launchId: string; creatorWallet: string }) {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [walletName, setWalletName] = useState("");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<FundingReview | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const storageKey = `topblast-funding:${launchId}`;
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => { const items = registry.get() as readonly Wallet[]; setWallets(items); setWalletName((current) => current || items[0]?.name || ""); };
    refresh();
    const off = registry.on("register", refresh);
    try { const saved = localStorage.getItem(storageKey); if (saved) setPending(saved); } catch { /* receipt remains visible in memory */ }
    return off;
  }, [storageKey]);
  useEffect(() => {
    const events = wallet?.features["standard:events"] as Events | undefined;
    if (!events) return;
    return events.on("change", ({ accounts }) => {
      const next = accounts?.find((item) => item.chains.some((chain) => chain.startsWith("solana:"))) ?? null;
      if (next?.address === account?.address) return;
      setAccount(null); setReview(null);
      setMessage("Wallet account changed. Reconnect the creator wallet and prepare a fresh funding review.");
    });
  }, [wallet, account?.address]);

  async function connect() {
    const selected = wallets.find((item) => item.name === walletName);
    if (!selected) throw new Error("Select an installed Solana wallet");
    const result = await (selected.features["standard:connect"] as Connect | undefined)?.connect();
    const next = result?.accounts.find((item) => item.chains.some((chain) => chain.startsWith("solana:")));
    if (!next) throw new Error("Wallet did not expose a Solana account");
    if (next.address !== creatorWallet) throw new Error("This funding action requires the launch creator wallet");
    setWallet(selected); setAccount(next);
  }

  async function prepare() {
    setBusy(true); setMessage("");
    try {
      if (!account) { await connect(); setMessage("Creator wallet connected. Review the amount, then continue."); return; }
      const response = await fetch("/api/funding/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ launchId, funderWallet: account.address, amount }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not prepare funding");
      setReview(body);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Funding preparation failed"); }
    finally { setBusy(false); }
  }

  async function sign() {
    if (!review || !wallet || !account) return;
    setBusy(true); setMessage("");
    try {
      if (new Date(review.expiresAt).getTime() < Date.now()) throw new Error("Funding quote expired. Prepare it again.");
      const signed = await (wallet.features["solana:signTransaction"] as Sign).signTransaction({ account, transaction: decode(review.unsignedTransaction), chain: "solana:mainnet" });
      if (!signed[0]) throw new Error("Wallet did not return a signed transaction");
      setPending(review.intentId);
      try { localStorage.setItem(storageKey, review.intentId); } catch { /* public receipt is still shown */ }
      const response = await fetch("/api/funding/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intentId: review.intentId, signedTransaction: encode(signed[0].signedTransaction) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Funding submission is uncertain. Use recovery before signing again.");
      setMessage(body.status === "confirmed" ? `Funding confirmed: ${body.signature}` : `Submitted: ${body.signature}. Awaiting finality.`);
      if (body.status === "confirmed") { setPending(null); setReview(null); try { localStorage.removeItem(storageKey); } catch {} }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Funding submission failed"); }
    finally { setBusy(false); }
  }

  async function recover() {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/funding/status/${pending}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage(body.status === "confirmed" ? `Funding confirmed: ${body.signature}` : `Funding is ${body.status}. Do not sign another deposit.`);
      if (body.status === "confirmed") { setPending(null); setReview(null); try { localStorage.removeItem(storageKey); } catch {} }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Recovery failed"); }
    finally { setBusy(false); }
  }

  return <div className="funding-card">
    <div className="section-label">Creator deposit funding</div>
    <p className="notice">StonkFun creator fees go to your creator wallet. Deposit a declared gross fee amount here. The fixed launch allocation sends the reward and protocol portions; your creator portion remains in your wallet.</p>
    {!account && <div className="lookup"><select aria-label="Solana wallet" value={walletName} onChange={(event) => setWalletName(event.target.value)}>{wallets.map((item) => <option key={item.name}>{item.name}</option>)}</select><button className="button button-secondary" type="button" onClick={() => void connect().catch((error) => setMessage(error.message))}>Connect creator</button></div>}
    {account && !review && !pending && <div className="lookup"><input aria-label="Gross STONK creator fee amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Gross STONK amount" /><button className="button" type="button" disabled={busy} onClick={prepare}>Review funding</button></div>}
    {review && !pending && <div className="transaction-review"><strong>Review exact allocation</strong><p className="notice">Gross: {review.grossAmountAtoms} atoms. Reward treasury: {review.rewardAmountAtoms}. Creator retained: {review.creatorAmountAtoms}. Protocol: {review.protocolAmountAtoms}. Mint: <span className="mono">{review.assetMint}</span>. Reward recipient: <span className="mono">{review.rewardTreasury}</span>.</p><button className="button" type="button" disabled={busy} onClick={sign}>Approve in wallet</button> <button className="button button-secondary" type="button" disabled={busy} onClick={() => setReview(null)}>Cancel</button></div>}
    {pending && <div role="status"><p className="notice">Funding receipt: <span className="mono">{pending}</span>. Recover this exact transaction before preparing another.</p><button className="button button-secondary" type="button" disabled={busy} onClick={recover}>Check funding finality</button></div>}
    {message && <div className={message.includes("confirmed") ? "success" : "notice"}>{message}</div>}
  </div>;
}
