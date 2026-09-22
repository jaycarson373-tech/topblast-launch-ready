import { describe, expect, it } from "vitest";
import { publicLink } from "../lib/site-links";

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
