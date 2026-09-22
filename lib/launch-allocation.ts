export const FIXED_PROTOCOL_PERCENT = 10;
export const CREATOR_REWARD_PERCENT = 100 - FIXED_PROTOCOL_PERCENT;
export const initialLaunchAllocation = { topblastPercent: 70, creatorPercent: 20, protocolPercent: FIXED_PROTOCOL_PERCENT };

export function updateLaunchAllocation(key: "topblastPercent" | "creatorPercent", value: number) {
  if (!Number.isFinite(value)) throw new Error("Enter a valid percentage");
  const percent = Math.min(CREATOR_REWARD_PERCENT, Math.max(0, Math.round(value)));
  return {
    topblastPercent: key === "topblastPercent" ? percent : CREATOR_REWARD_PERCENT - percent,
    creatorPercent: key === "creatorPercent" ? percent : CREATOR_REWARD_PERCENT - percent,
    protocolPercent: FIXED_PROTOCOL_PERCENT,
  };
}
