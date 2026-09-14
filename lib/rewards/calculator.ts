import type { RewardAllocation, RewardSnapshotPosition } from "@/lib/types";

export interface CalculateRewardsInput {
  launchId: string;
  epochId: string;
  fundedBudgetQuoteAtoms: bigint;
  snapshots: RewardSnapshotPosition[];
  maxPerWalletQuoteAtoms?: bigint;
}

export function calculateLossWeightedRewards(input: CalculateRewardsInput): RewardAllocation[] {
  if (input.fundedBudgetQuoteAtoms < 0n) throw new Error("Reward budget cannot be negative");
  const eligible = input.snapshots
    .filter((item) => item.launchId === input.launchId && item.status === "ELIGIBLE" && item.eligibleLossQuoteAtoms > 0n)
    .sort((a, b) => a.wallet.localeCompare(b.wallet));
  const foreign = input.snapshots.find((item) => item.launchId !== input.launchId);
  if (foreign) throw new Error("Cross-launch snapshot contamination detected");
  if (eligible.length === 0 || input.fundedBudgetQuoteAtoms === 0n) return [];
  const totalLoss = eligible.reduce((sum, item) => sum + item.eligibleLossQuoteAtoms, 0n);
  const cap = input.maxPerWalletQuoteAtoms ?? input.fundedBudgetQuoteAtoms;
  let remaining = input.fundedBudgetQuoteAtoms;
  const output = eligible.map((item) => {
    const weighted = input.fundedBudgetQuoteAtoms * item.eligibleLossQuoteAtoms / totalLoss;
    const amount = weighted > cap ? cap : weighted;
    remaining -= amount;
    return { launchId: input.launchId, epochId: input.epochId, wallet: item.wallet, amountQuoteAtoms: amount, eligibleLossQuoteAtoms: item.eligibleLossQuoteAtoms };
  });
  // Integer division remainder is assigned deterministically without crossing caps or budget.
  for (const item of output) {
    if (remaining === 0n) break;
    const room = cap - item.amountQuoteAtoms;
    const add = room < remaining ? room : remaining;
    item.amountQuoteAtoms += add;
    remaining -= add;
  }
  const distributed = output.reduce((sum, item) => sum + item.amountQuoteAtoms, 0n);
  if (distributed > input.fundedBudgetQuoteAtoms) throw new Error("Calculated rewards exceed funded budget");
  return output.filter((item) => item.amountQuoteAtoms > 0n);
}

export function splitFundedFees(
  launchId: string,
  feeEventLaunchId: string,
  totalAtoms: bigint,
  percentages: { topblastPercent: number; creatorPercent: number; protocolPercent: number },
) {
  if (launchId !== feeEventLaunchId) throw new Error("Fee event belongs to another launch");
  if (percentages.topblastPercent + percentages.creatorPercent + percentages.protocolPercent !== 100) {
    throw new Error("Fee allocation must total 100%");
  }
  const topblast = totalAtoms * BigInt(percentages.topblastPercent) / 100n;
  const creator = totalAtoms * BigInt(percentages.creatorPercent) / 100n;
  const protocol = totalAtoms - topblast - creator;
  return { topblast, creator, protocol };
}
