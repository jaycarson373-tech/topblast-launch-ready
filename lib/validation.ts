import { address } from "@solana/addresses";
import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "Use an HTTPS URL");
const optionalHttpsUrl = z.union([httpsUrl, z.literal("")]).optional().transform((value) => value || undefined);
const utf8Bytes = (maximum: number) =>
  z.string().min(1).refine((value) => new TextEncoder().encode(value).length <= maximum, `Must be ${maximum} UTF-8 bytes or fewer`);

export const allocationSchema = z
  .object({
    topblastPercent: z.number().int().min(0).max(100),
    creatorPercent: z.number().int().min(0).max(100),
    protocolPercent: z.number().int().min(0).max(100),
  })
  .refine((value) => value.topblastPercent + value.creatorPercent + value.protocolPercent === 100, {
    message: "Fee allocation must total 100%",
  });

export const launchDraftSchema = z.object({
  isTest: z.boolean().default(false),
  venue: z.enum(["stonkfun", "pumpfun"]).default("stonkfun"),
  pumpMint: z.string().refine((value) => { try { address(value); return true; } catch { return false; } }, "Invalid mint address").optional(),
  launchMint: z.string().refine((value) => { try { address(value); return true; } catch { return false; } }, "Invalid mint address").optional(),
  creatorWallet: z.string().refine((value) => {
    try { address(value); return true; } catch { return false; }
  }, "Invalid Solana wallet"),
  name: utf8Bytes(32),
  symbol: utf8Bytes(10).transform((value) => value.toUpperCase()),
  description: z.string().max(500),
  logo: z.string().startsWith("data:image/").max(2_800_000),
  quoteMint: z.string().refine((value) => {
    try { address(value); return true; } catch { return false; }
  }, "Invalid quote mint"),
  quoteSymbol: z.string().min(1).max(12),
  website: optionalHttpsUrl,
  twitter: optionalHttpsUrl,
  telegram: optionalHttpsUrl,
  feeTier: z.enum(["1%", "2%"]).default("1%"),
  allocation: allocationSchema,
});

export const submitLaunchSchema = z.object({
  launchId: z.string().uuid(),
  signedQuote: z.string().min(16),
  signedTransaction: z.string().min(32),
  logo: z.string().startsWith("data:image/").max(2_800_000),
});

export function validateMinimumReward(percent: number): void {
  const minimum = Number(process.env.TOPBLAST_MIN_REWARD_PERCENT ?? "50");
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) throw new Error("Invalid TOPBLAST_MIN_REWARD_PERCENT");
  if (percent < minimum) throw new Error(`TopBlast allocation must be at least ${minimum}%`);
}
