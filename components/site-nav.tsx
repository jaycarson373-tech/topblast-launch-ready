import Link from "next/link";

export function SiteNav() {
  return (
    <header className="site-nav">
      <Link href="/" className="brand"><span className="brand-mark">TB</span><span>TOPBLAST</span></Link>
      <nav>
        <Link href="/explore">Explore</Link>
        <Link href="/creator">Creator</Link>
        <Link href="/launch" className="button button-small">Launch token</Link>
      </nav>
    </header>
  );
}
