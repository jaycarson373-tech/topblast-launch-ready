import { createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";

export const devBuyReviewSchema = z.object({
  amount: z.string().max(60), quoteAtoms: z.string().regex(/^\d+$/),
  quoteMint: z.string(), quoteDecimals: z.number().int().min(0).max(18),
  minimumTokenAtoms: z.string().regex(/^\d+$/), tokenDecimals: z.number().int().min(0).max(18),
  recipient: z.string(), tokenAccount: z.string(),
});

export function devBuyAtoms(value: string | undefined, decimals: number): bigint {
  const text = value ?? "0";
  if (text.length > 60 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) throw new Error("Dev buy must be a non-negative decimal amount, not scientific notation");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Unverified dev-buy decimals");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`Dev buy supports at most ${decimals} decimal places for this pair`);
  const atoms = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (atoms > 18446744073709551615n) throw new Error("Dev buy exceeds the venue amount limit");
  return atoms;
}

export interface DevBuyReview {
  amount: string; quoteAtoms: string; quoteMint: string; quoteDecimals: number;
  minimumTokenAtoms: string; tokenDecimals: number; recipient: string; tokenAccount: string;
}

// For Stonk's WSOL pool, wrap only the requested amount in the creator's ATA.
// Do not close an existing ATA or sweep any pre-existing wrapped balance.
export function stonkBuyQuoteInstructions(payer: PublicKey, mint: PublicKey, atoms: bigint): TransactionInstruction[] {
  if (!mint.equals(NATIVE_MINT)) return [];
  const ata = getAssociatedTokenAddressSync(mint, payer);
  return [createAssociatedTokenAccountIdempotentInstruction(payer, ata, payer, mint, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: ata, lamports: atoms }), createSyncNativeInstruction(ata)];
}
