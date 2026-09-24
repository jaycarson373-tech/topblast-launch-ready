import { isAddress } from "@solana/addresses";
import type { LaunchSummary } from "@/lib/types";

export function parseFeaturedMints(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(isAddress))].slice(0, 10);
}

/** Editorial placement, not a volume or market-cap ranking. Never creates rows. */
export function orderFeaturedLaunches(launches: LaunchSummary[], mints: readonly string[]) {
  const rank = new Map(mints.map((mint, index) => [mint, index]));
  return [...launches].sort((a, b) => (rank.get(a.mint) ?? mints.length) - (rank.get(b.mint) ?? mints.length)
    || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
