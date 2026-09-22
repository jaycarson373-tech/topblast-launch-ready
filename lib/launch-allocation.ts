export const FIXED_PROTOCOL_PERCENT = 10;
export const CREATOR_REWARD_PERCENT = 100 - FIXED_PROTOCOL_PERCENT;
export const CREATOR_SHARE_STEP = 10;
export const initialCreatorShare = { topblastPercent: 80, creatorPercent: 20 };
export const initialLaunchAllocation = creatorShareToAllocation(initialCreatorShare);

export function updateCreatorShare(key: "topblastPercent" | "creatorPercent", value: number) {
  if (!Number.isFinite(value)) throw new Error("Enter a valid percentage");
  if (!Number.isInteger(value) || value < 0 || value > 100 || value % CREATOR_SHARE_STEP !== 0) throw new Error("Choose a share in 10-point increments");
  return {
    topblastPercent: key === "topblastPercent" ? value : 100 - value,
    creatorPercent: key === "creatorPercent" ? value : 100 - value,
  };
}

// UI percentages are of the creator-controlled 90%, not percentages of gross funding.
// Ten-point UI increments map exactly to the current immutable integer-percent schema.
export function creatorShareToAllocation(share: typeof initialCreatorShare) {
  updateCreatorShare("topblastPercent", share.topblastPercent);
  updateCreatorShare("creatorPercent", share.creatorPercent);
  if (share.topblastPercent + share.creatorPercent !== 100) throw new Error("Your share allocation must total 100%");
  return {
    topblastPercent: share.topblastPercent * CREATOR_REWARD_PERCENT / 100,
    creatorPercent: share.creatorPercent * CREATOR_REWARD_PERCENT / 100,
    protocolPercent: FIXED_PROTOCOL_PERCENT,
  };
}
