import type { PositionStatus, RewardSnapshotPosition, WalletPosition } from "@/lib/types";

export type PositionEvent =
  | { kind: "verified_buy"; launchId: string; wallet: string; tokenRaw: bigint; quoteAtoms: bigint; slot: bigint }
  | { kind: "sell"; launchId: string; wallet: string; tokenRaw: bigint; quoteAtoms?: bigint; slot: bigint }
  | { kind: "incoming_transfer"; launchId: string; wallet: string; tokenRaw: bigint; slot: bigint }
  | { kind: "outgoing_transfer"; launchId: string; wallet: string; tokenRaw: bigint; slot: bigint };

export function emptyPosition(launchId: string, wallet: string): WalletPosition {
  return {
    launchId, wallet, verifiedPurchasedRaw: 0n, verifiedRemainingRaw: 0n, balanceRaw: 0n,
    costBasisQuoteAtoms: 0n, previousRewardsQuoteAtoms: 0n, lastActivitySlot: 0n,
    lastSellSlot: null, lastOutgoingTransferSlot: null,
  };
}

export function applyPositionEvent(current: WalletPosition, event: PositionEvent): WalletPosition {
  if (current.launchId !== event.launchId || current.wallet !== event.wallet) {
    throw new Error("Position event does not belong to this launch and wallet");
  }
  if (event.tokenRaw <= 0n) throw new Error("Token amount must be positive");
  const next = { ...current, lastActivitySlot: event.slot };
  if (event.kind === "verified_buy") {
    next.verifiedPurchasedRaw += event.tokenRaw;
    next.verifiedRemainingRaw += event.tokenRaw;
    next.balanceRaw += event.tokenRaw;
    next.costBasisQuoteAtoms += event.quoteAtoms;
    return next;
  }
  if (event.kind === "incoming_transfer") {
    next.balanceRaw += event.tokenRaw;
    return next;
  }
  const removedFromBalance = event.tokenRaw > next.balanceRaw ? next.balanceRaw : event.tokenRaw;
  next.balanceRaw -= removedFromBalance;
  // Anti-gaming rule: an outgoing movement consumes verified units first. Incoming units never
  // create cost basis and cannot shield purchased units from a sell or transfer.
  const verifiedRemoved = event.tokenRaw > next.verifiedRemainingRaw ? next.verifiedRemainingRaw : event.tokenRaw;
  if (verifiedRemoved > 0n && next.verifiedRemainingRaw > 0n) {
    const removedCost = next.costBasisQuoteAtoms * verifiedRemoved / next.verifiedRemainingRaw;
    next.verifiedRemainingRaw -= verifiedRemoved;
    next.costBasisQuoteAtoms -= removedCost;
  }
  if (event.kind === "sell") next.lastSellSlot = event.slot;
  else next.lastOutgoingTransferSlot = event.slot;
  return next;
}

export interface SnapshotInput {
  position: WalletPosition;
  epochStartSlot: bigint;
  currentPriceQuoteAtomsPerToken: bigint;
  tokenDecimals: number;
  minimumHistorySlot?: bigint;
}

export function snapshotPosition(input: SnapshotInput): RewardSnapshotPosition {
  const { position } = input;
  const eligibleUnitsRaw = position.verifiedRemainingRaw < position.balanceRaw
    ? position.verifiedRemainingRaw : position.balanceRaw;
  let status: PositionStatus;
  if (position.verifiedPurchasedRaw === 0n) status = "NOT_A_VERIFIED_BUYER";
  else if (input.minimumHistorySlot && position.lastActivitySlot < input.minimumHistorySlot) status = "INSUFFICIENT_HISTORY";
  else if (position.lastSellSlot !== null && position.lastSellSlot >= input.epochStartSlot) status = "SOLD_THIS_EPOCH";
  else if (position.lastOutgoingTransferSlot !== null && position.lastOutgoingTransferSlot >= input.epochStartSlot) status = "TRANSFERRED";
  else if (eligibleUnitsRaw === 0n || position.costBasisQuoteAtoms === 0n) status = "NOT_A_VERIFIED_BUYER";
  else status = "ABOVE_ENTRY";

  const scale = 10n ** BigInt(input.tokenDecimals);
  const averageEntryQuoteAtoms = position.verifiedRemainingRaw > 0n
    ? position.costBasisQuoteAtoms * scale / position.verifiedRemainingRaw : 0n;
  const currentValueQuoteAtoms = eligibleUnitsRaw * input.currentPriceQuoteAtomsPerToken / scale;
  const eligibleCost = position.verifiedRemainingRaw > 0n
    ? position.costBasisQuoteAtoms * eligibleUnitsRaw / position.verifiedRemainingRaw : 0n;
  const eligibleLossQuoteAtoms = eligibleCost > currentValueQuoteAtoms ? eligibleCost - currentValueQuoteAtoms : 0n;
  if (status === "ABOVE_ENTRY" && eligibleLossQuoteAtoms > 0n) status = "ELIGIBLE";

  return {
    launchId: position.launchId, wallet: position.wallet, status, averageEntryQuoteAtoms,
    currentValueQuoteAtoms, eligibleUnitsRaw,
    eligibleLossQuoteAtoms: status === "ELIGIBLE" ? eligibleLossQuoteAtoms : 0n,
    previousRewardsQuoteAtoms: position.previousRewardsQuoteAtoms,
  };
}
