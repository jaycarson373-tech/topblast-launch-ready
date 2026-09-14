import { describe, expect, it } from "vitest";
import { calculateLossWeightedRewards, splitFundedFees } from "@/lib/rewards/calculator";
import { buildEpochPlan } from "@/lib/rewards/epoch";
import { applyPositionEvent, emptyPosition, snapshotPosition } from "@/lib/rewards/position";

const buy = (launchId: string, wallet = "wallet") => applyPositionEvent(emptyPosition(launchId, wallet), {
  kind: "verified_buy", launchId, wallet, tokenRaw: 100_000_000n, quoteAtoms: 1_000_000n, slot: 10n,
});

describe("multi-token TopBlast engine", () => {
  it("calculates weighted average entry across multiple buys", () => {
    const first = buy("a");
    const second = applyPositionEvent(first, { kind: "verified_buy", launchId: "a", wallet: "wallet", tokenRaw: 100_000_000n, quoteAtoms: 3_000_000n, slot: 11n });
    const snapshot = snapshotPosition({ position: second, epochStartSlot: 20n, currentPriceQuoteAtomsPerToken: 15_000n, tokenDecimals: 6 });
    expect(snapshot.averageEntryQuoteAtoms).toBe(20_000n);
    expect(snapshot.status).toBe("ELIGIBLE");
  });

  it("does not assign purchase basis to incoming transfers", () => {
    const position = applyPositionEvent(emptyPosition("a", "wallet"), { kind: "incoming_transfer", launchId: "a", wallet: "wallet", tokenRaw: 50n, slot: 10n });
    const snapshot = snapshotPosition({ position, epochStartSlot: 20n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 0 });
    expect(snapshot.status).toBe("NOT_A_VERIFIED_BUYER");
    expect(snapshot.averageEntryQuoteAtoms).toBe(0n);
  });

  it("excludes a seller for the current epoch", () => {
    const position = applyPositionEvent(buy("a"), { kind: "sell", launchId: "a", wallet: "wallet", tokenRaw: 10_000_000n, slot: 30n });
    expect(snapshotPosition({ position, epochStartSlot: 20n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6 }).status).toBe("SOLD_THIS_EPOCH");
    expect(snapshotPosition({ position, epochStartSlot: 31n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6 }).status).toBe("ELIGIBLE");
  });

  it("excludes an outgoing transfer for the current epoch", () => {
    const position = applyPositionEvent(buy("a"), { kind: "outgoing_transfer", launchId: "a", wallet: "wallet", tokenRaw: 10_000_000n, slot: 30n });
    expect(snapshotPosition({ position, epochStartSlot: 20n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6 }).status).toBe("TRANSFERRED");
  });

  it("never distributes more than the funded budget", () => {
    const plan = buildEpochPlan({ launchId: "a", epochId: "e1", startSlot: 20n, snapshotSlot: 40n, fundedBudgetQuoteAtoms: 7n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6, positions: [buy("a", "one"), buy("a", "two")] });
    expect(plan.distributedQuoteAtoms).toBe(7n);
  });

  it("handles a zero-fee epoch", () => {
    const plan = buildEpochPlan({ launchId: "a", epochId: "e1", startSlot: 20n, snapshotSlot: 40n, fundedBudgetQuoteAtoms: 0n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6, positions: [buy("a")] });
    expect(plan.allocations).toEqual([]);
  });

  it("rejects TOKEN A fees for TOKEN B", () => {
    expect(() => splitFundedFees("token-a", "token-b", 100n, { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 })).toThrow("another launch");
    const a = snapshotPosition({ position: buy("a"), epochStartSlot: 20n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6 });
    const b = snapshotPosition({ position: buy("b"), epochStartSlot: 20n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6 });
    expect(() => calculateLossWeightedRewards({ launchId: "a", epochId: "e1", fundedBudgetQuoteAtoms: 100n, snapshots: [a, b] })).toThrow("Cross-launch");
  });

  it("keeps the same wallet isolated across two launches", () => {
    const a = buy("a", "same-wallet");
    const b = applyPositionEvent(emptyPosition("b", "same-wallet"), { kind: "verified_buy", launchId: "b", wallet: "same-wallet", tokenRaw: 50n, quoteAtoms: 900n, slot: 10n });
    expect(a.costBasisQuoteAtoms).toBe(1_000_000n);
    expect(b.costBasisQuoteAtoms).toBe(900n);
  });
});
