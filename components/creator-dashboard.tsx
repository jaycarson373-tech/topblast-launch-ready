"use client";
import { useState } from "react";
import { getWallets } from "@wallet-standard/app";
import { FundingPanel } from "@/components/funding-panel";
import { VenueBadge } from "@/components/venue-badge";

interface Account { address:string }
interface Wallet { name:string; features:Record<string,unknown> }
interface Connect { connect():Promise<{accounts:readonly Account[]}> }
export function CreatorDashboard(){
  const [launches,setLaunches]=useState<Record<string,unknown>[]>([]); const [wallet,setWallet]=useState(""); const [error,setError]=useState("");
  async function connect(){try{const wallets=getWallets().get() as unknown as readonly Wallet[];const item=wallets.find((candidate)=>candidate.features["standard:connect"]);if(!item)throw new Error("No Solana wallet found");const result=await (item.features["standard:connect"] as Connect).connect();const address=result.accounts[0]?.address;if(!address)throw new Error("No wallet account returned");setWallet(address);const response=await fetch(`/api/creator?wallet=${encodeURIComponent(address)}`);const body=await response.json();if(!response.ok)throw new Error(body.error);setLaunches(body.launches??[])}catch(caught){setError(caught instanceof Error?caught.message:"Could not connect")}}
  return <>
    {!wallet ? <button className="button" onClick={connect}>Connect creator wallet</button> : <p className="mono">{wallet}</p>}
    {error && <div className="error">{error}</div>}
    {wallet && (launches.length ? <div className="cards">{launches.map((launch) => <div className="token-card" key={String(launch.id)}>
      <div className="token-card-head"><h3>{String(launch.name)}</h3><span className="status-pill">{String(launch.status)} · {String(launch.tracker_status ?? "tracker pending")}</span></div>
      <div className="creator-venue"><VenueBadge venue={String(launch.venue)} /></div>
      {launch.is_test === true && <p className="notice"><strong>TEST LAUNCH · NOT PUBLICLY LISTED</strong><br />Hidden from TopBlast Explore and token/proof pages. Onchain activity and venue listings remain public.</p>}
      <div className="metrics">
        <div className="metric"><span>Ticker</span><strong>${String(launch.symbol)}</strong></div>
        <div className="metric"><span>Volume</span><strong>{String(launch.volume_24h_usd ?? "Pending")}</strong></div>
        <div className="metric"><span>Epochs</span><strong>{Array.isArray(launch.reward_epochs) ? launch.reward_epochs.length : 0}</strong></div>
        <div className="metric"><span>Rules</span><strong>Fixed at launch</strong></div>
      </div>
      {launch.status === "active" && <FundingPanel launchId={String(launch.id)} creatorWallet={wallet} venue={String(launch.venue)} />}
    </div>)}</div> : <div className="empty">No launches are associated with this creator wallet.</div>)}
  </>;
}
