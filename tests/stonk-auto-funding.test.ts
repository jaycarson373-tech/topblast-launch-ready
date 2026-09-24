import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileStonkForwardedFees } from "@/lib/funding/stonk-auto";

describe("Stonk aggregated forwards fail closed", () => {
  it("never credits shared receipts, treasury sell proceeds or another launch's fees", async () => {
    const db = { from: vi.fn(() => { throw Error("Must not infer a funding credit"); }), rpc: vi.fn() };
    for (const launch_id of ["launch-a", "launch-b", "launch-a"]) {
      expect(await reconcileStonkForwardedFees(db as unknown as SupabaseClient, { launch_id }))
        .toMatchObject({ credited: 0, status: "attribution_required" });
    }
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
