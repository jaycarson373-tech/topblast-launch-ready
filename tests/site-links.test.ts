import { describe, expect, it } from "vitest";
import { publicLink } from "../lib/site-links";
import { readFileSync } from "node:fs";

describe("public footer destinations", () => {
  it("keeps missing social profiles unavailable", () => {
    expect(publicLink(undefined, ["x.com"])).toBeUndefined();
    expect(publicLink("", ["x.com"])).toBeUndefined();
  });
  it("accepts the confirmed HTTPS profile and token paths", () => {
    expect(publicLink("https://x.com/example", ["x.com"])).toBe("https://x.com/example");
    expect(publicLink("https://dexscreener.com/solana/example", ["dexscreener.com"])).toBe("https://dexscreener.com/solana/example");
  });
  it("rejects scripts, misleading hosts, insecure URLs and embedded credentials", () => {
    for (const url of ["javascript:alert(1)", "http://x.com/example", "https://x.com.evil.example", "https://user:password@x.com", "https://x.com:444", "not a url"]) {
      expect(publicLink(url, ["x.com"])).toBeUndefined();
    }
    expect(publicLink("https://unconfirmed.example", ["dexscreener.com"], "https://dexscreener.com/solana")).toBe("https://dexscreener.com/solana");
  });
});

it("offers the clearly labelled rehearsal without implying free mainnet launches", () => {
  for (const file of ["components/site-nav.tsx", "app/page.tsx", "app/launch/page.tsx", "app/docs/page.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/test now|try the free test|test without funds|run free simulation/i);
  }
  const docs = readFileSync(new URL("../app/docs/page.tsx", import.meta.url), "utf8");
  expect(readFileSync(new URL("../components/site-nav.tsx", import.meta.url), "utf8")).toContain('href="/test"');
  expect(docs).toContain("They are not proof of live payouts");
  expect(docs).toContain("Dry run locks funding and payout submission");
});
