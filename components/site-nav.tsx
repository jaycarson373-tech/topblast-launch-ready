import Link from "next/link";
import Image from "next/image";

export function SiteNav() {
  return (
    <header className="site-nav">
      <Link href="/" className="brand"><Image src="/topblast-mark.png" alt="" width={40} height={40} priority /><span>TOPBLAST <i>LAUNCH</i></span></Link>
      <nav aria-label="Main navigation">
        <Link href="/test">Test now</Link>
        <Link href="/explore">Explore</Link>
        <Link href="/creator">Creator</Link>
        <Link href="/launch" className="button button-small">Launch token</Link>
      </nav>
    </header>
  );
}
