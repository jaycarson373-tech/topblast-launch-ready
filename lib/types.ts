export type LaunchStatus = "prepared" | "processing" | "active" | "paused" | "failed";
export type PositionStatus =
  | "ELIGIBLE"
  | "ABOVE_ENTRY"
  | "TRANSFERRED"
  | "SOLD_THIS_EPOCH"
  | "INSUFFICIENT_HISTORY"
  | "NOT_A_VERIFIED_BUYER";

export interface FeeAllocationPolicy {
  topblastPercent: number;
  creatorPercent: number;
  protocolPercent: number;
}

export interface LaunchDraft {
  isTest?: boolean;
  venue?: "stonkfun" | "pumpfun";
  pumpMint?: string;
  creatorWallet: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  quoteMint: string;
  quoteSymbol: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  feeTier: "1%" | "2%";
  allocation: FeeAllocationPolicy;
}

export interface LaunchRecord extends LaunchDraft {
  id: string;
  mint: string | null;
  marketAddress: string | null;
  paymentSignature: string | null;
  launchSignature: string | null;
  status: LaunchStatus;
  createdAt: string;
  activatedAt: string | null;
}

export interface TrackedMarket {
  launchId: string;
  baseMint: string;
  quoteMint: string;
  marketAddress: string;
  venue: "stonkfun" | "pumpfun";
  tokenDecimals: number;
  quoteDecimals: number;
}

export interface WalletPosition {
  launchId: string;
  wallet: string;
  verifiedPurchasedRaw: bigint;
  verifiedRemainingRaw: bigint;
  balanceRaw: bigint;
  costBasisQuoteAtoms: bigint;
  previousRewardsQuoteAtoms: bigint;
  lastActivitySlot: bigint;
  lastSellSlot: bigint | null;
  lastOutgoingTransferSlot: bigint | null;
}

export interface RewardSnapshotPosition {
  launchId: string;
  wallet: string;
  status: PositionStatus;
  averageEntryQuoteAtoms: bigint;
  currentValueQuoteAtoms: bigint;
  eligibleUnitsRaw: bigint;
  eligibleLossQuoteAtoms: bigint;
  previousRewardsQuoteAtoms: bigint;
}

export interface RewardAllocation {
  launchId: string;
  epochId: string;
  wallet: string;
  amountQuoteAtoms: bigint;
  eligibleLossQuoteAtoms: bigint;
}

export interface LaunchSummary {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  quoteSymbol: string;
  creatorWallet: string;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  totalRewardedAtoms: string;
  eligibleWallets: number;
  createdAt: string;
  status: LaunchStatus;
  imageUrl?: string;
  trackerStatus?: string;
  totalFundedAtoms?: string;
}
