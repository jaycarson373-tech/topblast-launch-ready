import Link from "next/link";
import { getSiteLinks } from "@/lib/site-links";

export function SiteFooter() {
  const links = getSiteLinks();
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div className="footer-brand">
          <Link href="/" aria-label="TopBlast home">TOPBLAST<span aria-hidden="true">.</span></Link>
          <p>Your entry sets the line.</p>
        </div>
        <nav aria-label="Footer">
          <Link href="/docs">Docs</Link>
          {links.dexscreener ? <a href={links.dexscreener} target="_blank" rel="noopener noreferrer">Dexscreener <span aria-hidden="true">↗</span></a> : <span className="footer-pending">Dexscreener · market pending</span>}
          <a className="footer-stonk" href={links.stonk} target="_blank" rel="noopener noreferrer">StonkFun <span aria-hidden="true">↗</span></a>
          {links.x ? <a href={links.x} target="_blank" rel="noopener noreferrer">X <span aria-hidden="true">↗</span></a> : <span className="footer-pending">X · link pending</span>}
        </nav>
      </div>
    </footer>
  );
}
