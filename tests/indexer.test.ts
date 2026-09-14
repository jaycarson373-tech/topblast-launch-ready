import { describe, expect, it } from "vitest";
import { parseHeliusActivity } from "@/lib/indexer/helius";

const market = { launchId: "launch-a", baseMint: "BASE", quoteMint: "QUOTE", marketAddress: "POOL", venue: "stonkfun" as const, tokenDecimals: 6, quoteDecimals: 6 };

describe("Helius activity parser", () => {
  it("only recognizes a pool buy when the tracked market is present", () => {
    const tx = { signature: "sig", slot: 1, type: "SWAP", source: "RAYDIUM_LAUNCHLAB", accountData: [{ account: "POOL" }], tokenTransfers: [
      { mint: "QUOTE", fromUserAccount: "buyer", toUserAccount: "pool", rawTokenAmount: { tokenAmount: "100", decimals: 6 } },
      { mint: "BASE", fromUserAccount: "pool", toUserAccount: "buyer", rawTokenAmount: { tokenAmount: "1000", decimals: 6 } },
    ] };
    expect(parseHeliusActivity(tx, market)?.events[0]).toMatchObject({ kind: "verified_buy", launchId: "launch-a", wallet: "buyer", quoteAtoms: 100n, tokenRaw: 1000n });
    const unverified = parseHeliusActivity({ ...tx, accountData: [{ account: "OTHER" }] }, market);
    expect(unverified?.events.some((event) => event.kind === "verified_buy")).toBe(false);
    expect(unverified?.events.some((event) => event.kind === "incoming_transfer")).toBe(true);
  });

  it("classifies a plain inbound movement as transfer, not buy", () => {
    const result = parseHeliusActivity({ signature: "sig", slot: 1, type: "TRANSFER", source: "SYSTEM_PROGRAM", tokenTransfers: [
      { mint: "BASE", fromUserAccount: "from", toUserAccount: "receiver", rawTokenAmount: { tokenAmount: "1000", decimals: 6 } },
    ] }, market);
    expect(result?.events.map((event) => event.kind)).toEqual(["outgoing_transfer", "incoming_transfer"]);
  });
});

describe("real enhanced transfer payloads", () => {
  it("scales UI transfer amounts by the tracked mint decimals", () => {
    const result = parseHeliusActivity({ signature: "sig", slot: 1, type: "SWAP", source: "RAYDIUM_LAUNCHLAB", accountData: [{ account: "POOL" }], tokenTransfers: [
      { mint: "QUOTE", fromUserAccount: "buyer", toUserAccount: "pool", tokenAmount: 1.25 },
      { mint: "BASE", fromUserAccount: "pool", toUserAccount: "buyer", tokenAmount: 200 },
    ] }, { ...market, quoteDecimals: 9 });
    expect(result?.events[0]).toMatchObject({ kind: "verified_buy", tokenRaw: 200_000_000n, quoteAtoms: 1_250_000_000n });
  });
  it("ignores failed onchain transactions", () => {
    expect(parseHeliusActivity({ signature: "sig", slot: 1, transactionError: "failed", tokenTransfers: [{ mint: "BASE", toUserAccount: "buyer", tokenAmount: 1 }] }, market)).toBeNull();
  });
  it("refuses imprecise amounts rather than inventing raw balances", () => {
    expect(() => parseHeliusActivity({ signature: "sig", slot: 1, tokenTransfers: [{ mint: "BASE", toUserAccount: "buyer", tokenAmount: 1e20 }] }, market)).toThrow("Exact raw token amount");
  });
});
