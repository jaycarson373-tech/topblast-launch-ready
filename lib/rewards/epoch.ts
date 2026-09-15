import { calculateLossWeightedRewards } from "@/lib/rewards/calculator";
import { snapshotPosition } from "@/lib/rewards/position";
import type { WalletPosition } from "@/lib/types";

export interface EpochPlanInput {
  launchId: string;
  epochId: string;
  startSlot: bigint;
  snapshotSlot: bigint;
  fundedBudgetQuoteAtoms: bigint;
  currentPriceQuoteAtomsPerToken: bigint;
  tokenDecimals: number;
  positions: WalletPosition[];
}

export function buildEpochPlan(input: EpochPlanInput) {
  if (input.positions.some((position) => position.launchId !== input.launchId)) {
    throw new Error("Cross-launch position contamination detected");
  }
  if (input.positions.some((position) => position.lastActivitySlot > input.snapshotSlot)) throw new Error("Position includes activity after the finalized snapshot");
  const snapshots = input.positions.map((position) => snapshotPosition({
    position, epochStartSlot: input.startSlot,
    currentPriceQuoteAtomsPerToken: input.currentPriceQuoteAtomsPerToken,
    tokenDecimals: input.tokenDecimals,
  }));
  const allocations = calculateLossWeightedRewards({
    launchId: input.launchId, epochId: input.epochId,
    fundedBudgetQuoteAtoms: input.fundedBudgetQuoteAtoms, snapshots,
  });
  return {
    launchId: input.launchId, epochId: input.epochId,
    snapshotSlot: input.snapshotSlot, fundedBudgetQuoteAtoms: input.fundedBudgetQuoteAtoms,
    snapshots, allocations,
    distributedQuoteAtoms: allocations.reduce((sum, item) => sum + item.amountQuoteAtoms, 0n),
  };
}
