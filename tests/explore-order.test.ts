import { expect, it } from "vitest";
import { parseFeaturedMints, orderFeaturedLaunches } from "@/lib/explore-order";
import type { LaunchSummary } from "@/lib/types";

const top = "85iZwkRNwUs8q9sfLJCXhiVsny4faMyf5nbDQZ7x6omB";
const other = "So11111111111111111111111111111111111111112";
const row = (mint: string, createdAt: string, symbol = "TOP") => ({ mint, symbol, createdAt }) as LaunchSummary;

it("pins TOP then TOPBLAST by exact mint, not by a spoofable name", () => {
  const rows = [row("unlisted", "2026-09-26"), row(other, "2026-09-25", "TOPBLAST"), row(top, "2026-09-24")];
  expect(orderFeaturedLaunches(rows, [top, other]).map(r => r.mint)).toEqual([top, other, "unlisted"]);
  expect(rows[0].mint).toBe("unlisted");
});
it("never fabricates a pending listing or resurrects a hidden launch", () => {
  expect(orderFeaturedLaunches([], [top, other])).toEqual([]);
  expect(orderFeaturedLaunches([row(top, "2026-09-24")], [top, other])).toHaveLength(1);
});
it("accepts only unique public addresses in the configured editorial order", () => {
  expect(parseFeaturedMints(` ${top},not-a-mint,${other},${top}, `)).toEqual([top, other]);
  expect(parseFeaturedMints(undefined)).toEqual([]);
});
