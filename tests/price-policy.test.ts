import { describe, expect, it } from "vitest";
import { canonicalEpochPrice } from "@/lib/rewards/price-policy";

const point = (seconds: number, price: bigint) => ({ slot: seconds, blockTime: new Date(seconds * 1000).toISOString(), priceQuoteAtomsPerToken: price });
describe("canonical epoch price", () => {
  it("uses the higher spot after recovery", () => {
    const result = canonicalEpochPrice({ observations: [point(0, 10n), point(50, 10n), point(100, 20n)], startTime: new Date(0), endTime: new Date(100_000), maxGapSeconds: 60 });
    expect(result.twap).toBe(10n); expect(result.priceQuoteAtomsPerToken).toBe(20n);
  });
  it("does not let a last-second crash manufacture loss", () => {
    const result = canonicalEpochPrice({ observations: [point(0, 20n), point(99, 20n), point(100, 1n)], startTime: new Date(0), endTime: new Date(100_000), maxGapSeconds: 100 });
    expect(result.priceQuoteAtomsPerToken).toBe(20n);
  });
  it("fails closed on stale gaps", () => {
    expect(() => canonicalEpochPrice({ observations: [point(0, 20n), point(100, 1n)], startTime: new Date(0), endTime: new Date(100_000), maxGapSeconds: 30 })).toThrow("gap");
  });
});
