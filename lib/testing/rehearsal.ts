// Browser-only rehearsal data. Never use these fixtures to fund a production epoch.
// The position and allocation calculations below are the production implementations.
import { z } from "zod";
import { applyPositionEvent, emptyPosition, type PositionEvent } from "@/lib/rewards/position";
import { buildEpochPlan } from "@/lib/rewards/epoch";
import { splitFundedFees } from "@/lib/rewards/calculator";
import type { WalletPosition } from "@/lib/types";

export const rehearsalSchema = z.object({
  version: z.literal(1),
  step: z.number().int().min(0).max(5),
  price: z.number().int().min(1).max(30),
  gross: z.number().int().min(0).max(1000),
  movement: z.enum(["holding", "sell", "outgoing_transfer", "incoming_transfer"]),
  paidKeys: z.array(z.string().max(150)).max(20),
  recoveryRuns: z.number().int().min(0).max(1000),
});
export type RehearsalState = z.infer<typeof rehearsalSchema>;
export const newRehearsal = (): RehearsalState => ({ version: 1, step: 0, price: 5, gross: 100, movement: "holding", paidKeys: [], recoveryRuns: 0 });
export const REHEARSAL_KEY = "topblast-rehearsal-v1";
const QUOTE_SCALE = 100n; // Fictional STONK units, deliberately not a live mint's decimals.
export const rehearsalAmount = (atoms: bigint) => `${atoms / QUOTE_SCALE}.${(atoms % QUOTE_SCALE).toString().padStart(2, "0")}`;

function positions(launchId: string, state: RehearsalState): WalletPosition[] {
  const events: PositionEvent[] = [
    { kind: "verified_buy", launchId, wallet: "Holder A", tokenRaw: 10n, quoteAtoms: 10000n, slot: 10n },
    { kind: "verified_buy", launchId, wallet: "Holder A", tokenRaw: 10n, quoteAtoms: 20000n, slot: 11n },
    { kind: "verified_buy", launchId, wallet: "Holder B", tokenRaw: 10n, quoteAtoms: 10000n, slot: 12n },
    { kind: "incoming_transfer", launchId, wallet: "Transfer-only wallet", tokenRaw: 20n, slot: 13n },
  ];
  if (state.movement !== "holding") events.push({ kind: state.movement, launchId, wallet: "Holder A", tokenRaw: 5n, slot: 30n });
  const wallets = new Map<string, WalletPosition>();
  for (const event of events) wallets.set(event.wallet, applyPositionEvent(wallets.get(event.wallet) ?? emptyPosition(launchId, event.wallet), event));
  return [...wallets.values()];
}

export function rehearsalPlan(state: RehearsalState, launchId = "SIM-A") {
  const split = splitFundedFees(launchId, launchId, BigInt(state.gross) * QUOTE_SCALE, { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 });
  const budget = state.step >= 2 && launchId === "SIM-A" ? split.topblast : 0n;
  const plan = buildEpochPlan({
    launchId, epochId: `${launchId}:epoch-1`, startSlot: 20n, snapshotSlot: 40n,
    fundedBudgetQuoteAtoms: budget, currentPriceQuoteAtomsPerToken: BigInt(state.price) * QUOTE_SCALE,
    tokenDecimals: 0, positions: positions(launchId, state),
  });
  const payments = state.step >= 3 ? plan.allocations.map((item) => ({ ...item, key: `${item.epochId}:${item.wallet}`, simulatedPaid: state.paidKeys.includes(`${item.epochId}:${item.wallet}`) })) : [];
  const reserved = state.step >= 3 ? plan.distributedQuoteAtoms : 0n;
  const paid = payments.filter((item) => item.simulatedPaid).reduce((sum, item) => sum + item.amountQuoteAtoms, 0n);
  return { ...plan, split, payments, available: budget - reserved, reserved: reserved - paid, paid };
}

export function advanceRehearsal(current: RehearsalState): RehearsalState {
  const state = rehearsalSchema.parse(current);
  if (state.step < 3) return { ...state, step: state.step + 1 };
  const keys = rehearsalPlan(state).payments.map((item) => item.key);
  if (state.step === 3) return { ...state, step: 4, paidKeys: keys.slice(0, 1) };
  // A simulated external transport acknowledges the same payment keys on recovery.
  // This is NOT a claim about production RPC confirmation or worker restart behavior.
  return { ...state, step: 5, paidKeys: [...new Set([...state.paidKeys, ...keys])], recoveryRuns: Math.min(1000, state.recoveryRuns + 1) };
}

export function runRehearsal(state: RehearsalState) {
  let next = state;
  while (next.step < 5) next = advanceRehearsal(next);
  return next;
}
