import { expect, it } from "vitest";
import { formatTokenAtoms, tokenVenueUrl } from "@/lib/token-display";
import { chartPoints } from "@/lib/chart-points";
it("keeps tiny prices and whole-unit trailing zeros exact", () => {
  expect(formatTokenAtoms("10307", 9)).toBe("0.000010307");
  expect(formatTokenAtoms("100000000000", 9)).toBe("100");
  expect(formatTokenAtoms("1", 9)).toBe("0.000000001");
  expect(formatTokenAtoms(null, 9)).toBe("Unavailable");
  expect(formatTokenAtoms("0", 9)).toBe("0");
  expect(formatTokenAtoms("100", 0)).toBe("100");
});
it("uses the actual venue token routes", () => {
  expect(tokenVenueUrl("stonkfun", "mint")).toBe("https://www.stonkfun.xyz/token/mint");
  expect(tokenVenueUrl("pumpfun", "mint")).toBe("https://pump.fun/coin/mint");
});
it("sorts chart observations and removes duplicate seconds and invalid prices", () => {
  expect(chartPoints([
    { block_time: "2026-09-22T12:00:01Z", price_quote_atoms_per_token: "100" },
    { block_time: "bad", price_quote_atoms_per_token: "1" },
    { block_time: "2026-09-22T12:00:00Z", price_quote_atoms_per_token: "200" },
    { block_time: "2026-09-22T12:00:01.100Z", price_quote_atoms_per_token: "300" },
    { block_time: "2026-09-22T12:00:02Z", price_quote_atoms_per_token: "0" },
  ], 2)).toEqual([{ time: 1790078400, value: 2 }, { time: 1790078401, value: 3 }]);
});
