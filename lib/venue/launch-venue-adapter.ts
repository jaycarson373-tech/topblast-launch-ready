import type { LaunchDraft } from "@/lib/types";

export interface PreparedLaunch {
  signedQuote: string;
  paymentTransaction: string;
  payment: { lamports: string | number; sol?: string | number; recipient?: string };
  expiresAt?: string;
  raw: Record<string, unknown>;
}

export interface SubmittedLaunch {
  status: "processing" | "completed" | "failed";
  paymentSignature: string;
  mint?: string;
  pool?: string;
  signature?: string;
  raw: Record<string, unknown>;
}

export interface VenueLaunch {
  status: "processing" | "completed" | "failed";
  paymentSignature: string;
  mint?: string;
  pool?: string;
  signature?: string;
  raw: Record<string, unknown>;
}

export interface VenuePair {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  launchable: boolean;
  launchLabReady?: boolean;
}

export interface CreatorFees {
  claimable: null | Record<string, unknown>;
  reason?: string;
  scope?: string;
  raw: Record<string, unknown>;
}
export interface VenueMarketData { priceUsd: number | null; marketCapUsd: number | null; volume24hUsd: number | null; liquidityUsd: number | null; raw: Record<string, unknown> }

export interface PreparedFeeClaim {
  intentId: string;
  transaction: string;
  expiresAt?: string;
  raw: Record<string, unknown>;
}

export interface LaunchVenueAdapter {
  readonly venue: string;
  createLaunch(input: LaunchDraft): Promise<PreparedLaunch>;
  submitLaunch(input: { signedQuote: string; signedTransaction: string; logo: string }): Promise<SubmittedLaunch>;
  getLaunch(paymentSignature: string): Promise<VenueLaunch>;
  getPair(mint: string): Promise<VenuePair | null>;
  getCreatorFees(mint: string): Promise<CreatorFees>;
  getMarketData(mint: string, expectedPool: string): Promise<VenueMarketData>;
  prepareCreatorFeeClaim(mint: string, creatorWallet: string): Promise<PreparedFeeClaim>;
  claimCreatorFees(input: {
    mint: string;
    creatorWallet: string;
    intentId: string;
    signedTransaction: string;
  }): Promise<{ signature: string; alreadySubmitted: boolean; raw: Record<string, unknown> }>;
}
