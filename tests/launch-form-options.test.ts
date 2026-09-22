import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCreatorShare, creatorShareToAllocation } from "@/lib/launch-allocation";
import { splitFundedFees } from "@/lib/rewards/calculator";
import { allocationSchema, launchDraftSchema } from "@/lib/validation";
import { launchPageUsesTestMode } from "@/lib/launch-page-mode";
import { validateTokenImage } from "@/lib/token-image";

afterEach(() => vi.unstubAllEnvs());

describe("main launch page mode", () => {
  it("routes the normal launch CTA into the open test flow while ordinary launches are closed", () => {
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
    vi.stubEnv("LAUNCHES_ENABLED", "false");
    expect(launchPageUsesTestMode()).toBe(true);
    vi.stubEnv("LAUNCHES_ENABLED", "true");
    expect(launchPageUsesTestMode()).toBe(false);
    vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "false");
    vi.stubEnv("LAUNCHES_ENABLED", "false");
    expect(launchPageUsesTestMode()).toBe(false);
  });
});

describe("fixed new-launch allocation", () => {
  it("adjusts the complementary share and always totals 100 with fixed protocol", () => {
    for (const key of ["topblastPercent", "creatorPercent"] as const) {
      for (let percent = 0; percent <= 100; percent += 10) {
        const share = updateCreatorShare(key, percent);
        expect(share.topblastPercent + share.creatorPercent).toBe(100);
        const split = creatorShareToAllocation(share);
        expect(split.protocolPercent).toBe(10);
        expect(split.topblastPercent + split.creatorPercent).toBe(90);
        expect(allocationSchema.safeParse(split).success).toBe(true);
      }
    }
    expect(creatorShareToAllocation(updateCreatorShare("creatorPercent", 20))).toEqual({ topblastPercent: 72, creatorPercent: 18, protocolPercent: 10 });
  });
  it("rejects invalid numbers and enforces the fixed share server-side for new launches only", () => {
    expect(() => updateCreatorShare("creatorPercent", NaN)).toThrow("valid percentage");
    expect(() => updateCreatorShare("creatorPercent", 15)).toThrow("10-point");
    expect(() => creatorShareToAllocation({ topblastPercent: 80, creatorPercent: 30 })).toThrow("total 100");
    expect(launchDraftSchema.shape.allocation.safeParse({ topblastPercent: 70, creatorPercent: 30, protocolPercent: 0 }).success).toBe(false);
    expect(launchDraftSchema.shape.allocation.safeParse({ topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 }).success).toBe(true);
    // Existing recorded policies are not rewritten or rejected by the generic policy schema.
    expect(allocationSchema.safeParse({ topblastPercent: 70, creatorPercent: 25, protocolPercent: 5 }).success).toBe(true);
  });
  it("funds the exact normalized split for both venues with no cross-launch attribution", () => {
    for (const launch of ["stonk-launch", "pump-launch"]) {
      const policy = creatorShareToAllocation({ topblastPercent: 80, creatorPercent: 20 });
      expect(splitFundedFees(launch, launch, 10000n, policy)).toEqual({ topblast: 7200n, creator: 1800n, protocol: 1000n });
      expect(() => splitFundedFees(launch, "other-launch", 10000n, policy)).toThrow("another launch");
    }
  });
});

describe("token image selection", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts supported %s preview inputs", (type) => {
    expect(() => validateTokenImage({ type, size: 2_000_000 })).not.toThrow();
  });
  it("rejects unsupported, empty and oversized image selections", () => {
    expect(() => validateTokenImage({ type: "image/svg+xml", size: 100 })).toThrow("PNG");
    expect(() => validateTokenImage({ type: "image/png", size: 0 })).toThrow("2 MB");
    expect(() => validateTokenImage({ type: "image/png", size: 2_000_001 })).toThrow("2 MB");
  });
});
