"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

export function SiteNav({ featuredMint, xUrl }: { featuredMint?: string; xUrl: string }) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  async function copyAddress() {
    if (!featuredMint) return;
    try { await navigator.clipboard.writeText(featuredMint); setCopyStatus("CA copied"); }
    catch { setCopyStatus("Copy unavailable. Open the token page to copy its address."); }
  }
  return <header className="site-nav">
    <Link href="/" className="brand" aria-label="TopBlast home" onClick={() => setOpen(false)}><Image src="/logo-mark.png" alt="" width={40} height={40} priority /></Link>
    <div className="nav-tools">
      <button className="ca-button" onClick={copyAddress} disabled={!featuredMint} title={featuredMint || "Contract address not set"} aria-label={featuredMint ? `Copy contract address ${featuredMint}` : "Contract address not set"}>
        <span>CA:</span><span className="ca-address">{featuredMint ? `${featuredMint.slice(0, 4)}…${featuredMint.slice(-4)}` : ""}</span>
        {featuredMint && <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">{copyStatus === "CA copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V4H4v12h4" /></>}</svg>}
      </button>
      <a className="social-button" href={xUrl} target="_blank" rel="noopener noreferrer" aria-label="TopBlast Launch on X"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg></a>
      <button className="menu-toggle" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
    </div>
    <nav id="main-navigation" aria-label="Main navigation" className={open ? "is-open" : ""} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onClick={() => setOpen(false)}>
      <Link href="/explore">Explore</Link><Link href="/creator">Creators</Link><Link href="/docs">Docs</Link>
      {featuredMint && <Link href={`/token/${featuredMint}`}>Our token</Link>}
      <div className="nav-launch"><Link href="/launch" className="button button-small">Launch</Link></div>
    </nav>
    <span className="sr-only" role="status">{copyStatus}</span>
  </header>;
}
