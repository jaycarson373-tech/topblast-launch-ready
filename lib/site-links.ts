/** Only publish confirmed HTTPS destinations. Never turn a missing handle into a fake profile. */
export function publicLink(value: string | undefined, hosts: readonly string[], fallback?: string): string | undefined {
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.includes(url.hostname)) return url.href;
    } catch { /* Unconfigured links stay unavailable. */ }
  }
  return fallback;
}

export function getSiteLinks() {
  return {
    dexscreener: publicLink(process.env.NEXT_PUBLIC_DEXSCREENER_URL, ["dexscreener.com", "www.dexscreener.com"], "https://dexscreener.com/solana")!,
    stonk: publicLink(process.env.NEXT_PUBLIC_STONK_URL, ["stonkfun.xyz", "www.stonkfun.xyz"], "https://www.stonkfun.xyz")!,
    x: publicLink(process.env.NEXT_PUBLIC_X_URL, ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
  };
}
