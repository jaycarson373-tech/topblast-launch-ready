"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { NavStatus } from "@/components/platform-state";

export function SiteNav({ featuredMint }: { featuredMint?: string }) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  async function copyAddress() {
    if (!featuredMint) return;
    try { await navigator.clipboard.writeText(featuredMint); setCopyStatus("CA copied"); }
    catch { setCopyStatus("Copy unavailable. Open the token page to copy its address."); }
  }
  return <header className="site-nav">
    <Link href="/" className="brand" onClick={() => setOpen(false)}><Image src="/logo-mark.svg" alt="" width={40} height={40} priority /><span>TOPBLAST <i>LAUNCH</i></span></Link>
    <div className="nav-tools"><button className="ca-button" disabled={!featuredMint} onClick={copyAddress} title={featuredMint ?? "Our token has not launched yet. No contract address is configured."}>{copyStatus === "CA copied" ? "CA copied" : featuredMint ? "Copy CA" : "CA pending"}</button><button className="menu-toggle" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button></div>
    <nav id="main-navigation" aria-label="Main navigation" className={open ? "is-open" : ""} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onClick={() => setOpen(false)}>
      <Link href="/explore">Explore</Link><Link href="/test">Test</Link><Link href="/creator">Creators</Link><Link href="/docs">Docs</Link>
      {featuredMint && <Link href={`/token/${featuredMint}`}>Our token</Link>}
      <div className="nav-launch"><NavStatus /><Link href="/launch" className="button button-small">Launch</Link></div>
    </nav>
    <span className="sr-only" role="status">{copyStatus}</span>
  </header>;
}
