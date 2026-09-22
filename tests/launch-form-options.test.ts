import { afterEach, describe, expect, it, vi } from "vitest";
import { updateLaunchAllocation } from "@/lib/launch-allocation";
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
      for (let percent = -5; percent < 110; percent++) {
        const split = updateLaunchAllocation(key, percent);
        expect(split.protocolPercent).toBe(10);
        expect(split.topblastPercent + split.creatorPercent).toBe(90);
        expect(allocationSchema.safeParse(split).success).toBe(true);
      }
    }
    expect(updateLaunchAllocation("creatorPercent", 15)).toEqual({ topblastPercent: 75, creatorPercent: 15, protocolPercent: 10 });
  });
  it("rejects invalid numbers and enforces the fixed share server-side for new launches only", () => {
    expect(() => updateLaunchAllocation("creatorPercent", NaN)).toThrow("valid percentage");
    expect(launchDraftSchema.shape.allocation.safeParse({ topblastPercent: 70, creatorPercent: 30, protocolPercent: 0 }).success).toBe(false);
    expect(launchDraftSchema.shape.allocation.safeParse({ topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 }).success).toBe(true);
    // Existing recorded policies are not rewritten or rejected by the generic policy schema.
    expect(allocationSchema.safeParse({ topblastPercent: 70, creatorPercent: 25, protocolPercent: 5 }).success).toBe(true);
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
