import { createHash, randomUUID } from "node:crypto";
import BN from "bn.js";
import { z } from "zod";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { getAdminDb } from "@/lib/db/server";
import { solanaRpc } from "@/lib/solana/rpc";
import { LAUNCHLAB_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "@/lib/solana/launchlab-constants";
import { initializeV2, initializeWithToken2022, getPdaLaunchpadAuth, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId,
  getPdaLaunchpadConfigId, getPdaMetadataKey, getPdaPlatformCurveRule, getPdaPlatformAllowConfig,
  LaunchpadConfig, PlatformConfig, PlatformCurveRule } from "@/lib/solana/launchlab-sdk";
import { validatePumpImage } from "@/lib/venue/pumpfun-adapter";
import { broadcastSignedCheckedTransfer } from "@/lib/solana/checked-transfers";
import type { LaunchDraft } from "@/lib/types";
import type { PreparedLaunch, SubmittedLaunch } from "@/lib/venue/launch-venue-adapter";

// Official StonkFun standard platform, not Raydium's default platform.
// Source: StonkFun /api/public/v1/launchlab/pricing, 2026-09-21.
export const STONK_STANDARD_PLATFORM = "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7";
const publicKey = z.string().refine((value) => { try { return new PublicKey(value).toBase58() === value; } catch { return false; } });
const rawAmount = z.string().regex(/^(0|[1-9][0-9]*)$/).refine((value) => BigInt(value) <= 18446744073709551615n);
export const stonkPricingSchema = z.object({
  quote: z.object({ mint: publicKey, decimals: z.number().int().min(0).max(18), tokenProgram: z.literal(TOKEN_PROGRAM) }),
  raise: z.object({ raw: rawAmount.refine((value) => BigInt(value) > 0n) }),
  prices: z.object({ observedAt: z.string().datetime() }),
  curve: z.object({ programId: z.literal(LAUNCHLAB_PROGRAM), configId: publicKey,
    curveType: z.literal("ConstantCurve"), migrateType: z.literal("cpmm"), baseDecimals: z.number().int().min(0).max(9),
    supply: rawAmount, totalSellA: rawAmount, cpmmCreatorFeeOn: z.union([z.literal(0), z.literal(1)]),
    vesting: z.object({ totalLockedAmount: z.literal("0"), cliffPeriod: z.literal("0"), unlockPeriod: z.literal("0") }),
  }),
  platform: z.object({ standard: z.literal(STONK_STANDARD_PLATFORM) }),
  curveRule: z.object({ standard: publicKey }),
  modes: z.object({ standard: z.object({ transferFee: z.null() }) }),
});

// Evaluate the venue's published, onchain rule. Never alter its supply/raise to
// evade a restriction. Token-2022 with NO transfer-fee extension is a standard mint.
export function stonkRuleAllows(pricing: z.infer<typeof stonkPricingSchema>, rule: ReturnType<typeof PlatformCurveRule.decode>, token2022: boolean) {
  const supply = BigInt(pricing.curve.supply), sell = BigInt(pricing.curve.totalSellA), raise = BigInt(pricing.raise.raw);
  const fields = [0n, 1n, BigInt(pricing.curve.cpmmCreatorFeeOn), supply, sell, raise, 0n, 0n, 0n,
    token2022 ? 1n : 0n, 0n, 0n, 0n, sell * 1_000_000n / supply, 0n, supply - sell,
    (supply - sell) * 1_000_000n / supply, raise * 1_000_000n / supply, BigInt(Math.floor(Date.now() / 1000))];
  if (!rule.groups.length || rule.groups.length > 10) return false;
  return rule.groups.some((group) => group.constraints.length > 0 && group.constraints.length <= 25 && group.constraints.every(({ field, op, value }) => {
    const actual = fields[field], expected = BigInt(value.toString());
    if (actual === undefined) return false;
    return op === 0 ? actual === expected : op === 1 ? actual >= expected : op === 2 ? actual <= expected : op === 3 ? actual !== expected : false;
  }));
}

type ChainAccount = { owner: string; executable?: boolean; data: [string, string] };
function accountData(account: ChainAccount | null, name: string, size: number) {
  if (!account || account.executable || account.owner !== LAUNCHLAB_PROGRAM || account.data?.[1] !== "base64") throw new Error(`Unverified Stonk ${name} account`);
  const bytes = Buffer.from(account.data[0], "base64");
  const discriminator = createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
  if (bytes.length !== size || !bytes.subarray(0, 8).equals(discriminator)) throw new Error(`Unsupported Stonk ${name} layout`);
  return bytes;
}

export async function verifyStonkPricing(raw: unknown, quoteMint: string) {
  const pricing = stonkPricingSchema.parse(raw);
  if (pricing.quote.mint !== quoteMint) throw new Error("Stonk pricing quote mint mismatch");
  const age = Date.now() - new Date(pricing.prices.observedAt).getTime();
  if (age < -30_000 || age > 180_000) throw new Error("Stonk pricing is stale. Prepare a fresh review.");
  if (BigInt(pricing.curve.totalSellA) <= 0n || BigInt(pricing.curve.totalSellA) >= BigInt(pricing.curve.supply)) throw new Error("Invalid Stonk supply parameters");
  if (await solanaRpc<string>("getGenesisHash") !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("Stonk creation requires Solana mainnet");
  const program = new PublicKey(LAUNCHLAB_PROGRAM), config = new PublicKey(pricing.curve.configId), platform = new PublicKey(pricing.platform.standard);
  if (getPdaPlatformCurveRule(program, platform, config).publicKey.toBase58() !== pricing.curveRule.standard) throw new Error("Stonk curve rule address mismatch");
  const result = await solanaRpc<{ value: Array<ChainAccount | null> }>("getMultipleAccounts", [[config.toBase58(), platform.toBase58(), quoteMint, pricing.curveRule.standard], { encoding: "base64", commitment: "finalized" }]);
  const configInfo = LaunchpadConfig.decode(accountData(result.value[0], "GlobalConfig", LaunchpadConfig.span));
  const platformInfo = PlatformConfig.decode(accountData(result.value[1], "PlatformConfig", PlatformConfig.span));
  if (configInfo.mintB.toBase58() !== quoteMint || configInfo.curveType !== 0 || getPdaLaunchpadConfigId(program, new PublicKey(quoteMint), 0, configInfo.index).publicKey.toBase58() !== config.toBase58()) throw new Error("Stonk global config identity mismatch");
  const mint = result.value[2];
  const mintBytes = Buffer.from(mint?.data?.[0] ?? "", "base64");
  if (mint?.owner !== TOKEN_PROGRAM || mint.data?.[1] !== "base64" || mintBytes.length !== 82 || mintBytes[45] !== 1 || mintBytes[44] !== pricing.quote.decimals) throw new Error("Stonk quote mint decimals or ownership mismatch");
  if (new BN(pricing.raise.raw).lt(configInfo.minFundRaisingB)) throw new Error("Stonk raise is below the venue minimum");
  if (platformInfo.restrictGlobalConfig > 1 || platformInfo.restrictCurveParam > 1) throw new Error("Unsupported Stonk platform restrictions");
  let token2022 = false;
  if (platformInfo.restrictCurveParam === 1) {
    const account = result.value[3];
    const length = Buffer.from(account?.data?.[0] ?? "", "base64").length;
    if (length < 154 || length > 8192) throw new Error("Stonk curve rule unavailable or unsupported");
    const rule = PlatformCurveRule.decode(accountData(account, "PlatformCurveRule", length));
    if (rule.platformId.toBase58() !== platform.toBase58() || rule.configId.toBase58() !== config.toBase58()) throw new Error("Stonk curve rule identity mismatch");
    if (!stonkRuleAllows(pricing, rule, false)) {
      if (!stonkRuleAllows(pricing, rule, true)) throw new Error("Stonk pricing conflicts with its onchain launch rules. No launch can be prepared.");
      token2022 = true;
    }
  }
  return { pricing, platformInfo, configInfo, token2022 };
}

export async function simulateStonkLaunch(input: LaunchDraft, verified: Awaited<ReturnType<typeof verifyStonkPricing>>) {
  if (!input.launchMint) throw new Error("Refresh the page to prepare a Stonk launch with a browser-generated mint");
  validatePumpImage(input.logo);
  const { pricing, platformInfo, configInfo, token2022 } = verified;
  const creator = new PublicKey(input.creatorWallet), mint = new PublicKey(input.launchMint), quote = new PublicKey(input.quoteMint);
  if (!PublicKey.isOnCurve(creator.toBytes()) || !PublicKey.isOnCurve(mint.toBytes()) || creator.equals(mint) || quote.equals(mint)) throw new Error("Invalid creator or new mint signer");
  const exists = await solanaRpc<{ value: unknown }>("getAccountInfo", [input.launchMint, { commitment: "finalized", encoding: "base64" }]);
  if (exists.value !== null) throw new Error("Mint already exists. Prepare a new launch.");
  const metadataId = randomUUID();
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://topblast-stonkfun-launchpad.vercel.app").origin;
  const uri = `${origin}/api/metadata/${metadataId}`;
  const program = new PublicKey(LAUNCHLAB_PROGRAM), config = new PublicKey(pricing.curve.configId), platform = new PublicKey(pricing.platform.standard);
  const pool = getPdaLaunchpadPoolId(program, mint, quote).publicKey;
  // Use the official initializeV2 builder and Stonk's exact published shape.
  // No buy, swap, arbitrary fee recipient, or transfer-tax extension is added.
  const curve = { type: "ConstantCurve" as const, migrateType: "cpmm" as const, supply: new BN(pricing.curve.supply), totalSellA: new BN(pricing.curve.totalSellA), totalFundRaisingB: new BN(pricing.raise.raw) };
  const allowConfig = platformInfo.restrictGlobalConfig === 1 ? getPdaPlatformAllowConfig(program, platform, config).publicKey : undefined;
  const create = token2022 ? initializeWithToken2022(program, creator, creator, config, platform, getPdaLaunchpadAuth(program).publicKey,
    pool, mint, quote, getPdaLaunchpadVaultId(program, pool, mint).publicKey, getPdaLaunchpadVaultId(program, pool, quote).publicKey,
    new PublicKey(pricing.quote.tokenProgram), pricing.curve.baseDecimals, input.name, input.symbol, uri, curve,
    new BN(0), new BN(0), new BN(0), pricing.curve.cpmmCreatorFeeOn, undefined, allowConfig, new PublicKey(pricing.curveRule.standard))
    : initializeV2(program, creator, creator, config, platform, getPdaLaunchpadAuth(program).publicKey,
    pool, mint, quote, getPdaLaunchpadVaultId(program, pool, mint).publicKey, getPdaLaunchpadVaultId(program, pool, quote).publicKey,
    getPdaMetadataKey(mint).publicKey, new PublicKey(pricing.quote.tokenProgram), pricing.curve.baseDecimals, input.name, input.symbol, uri,
    curve,
    new BN(0), new BN(0), new BN(0), pricing.curve.cpmmCreatorFeeOn,
    allowConfig,
    new PublicKey(pricing.curveRule.standard));
  const latest = await solanaRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
  if (!Number.isSafeInteger(latest.value.lastValidBlockHeight)) throw new Error("Launch blockhash validity unavailable");
  const transaction = new Transaction({ feePayer: creator, recentBlockhash: latest.value.blockhash })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }), create);
  const wire = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const before = await solanaRpc<{ context: { slot: number }; value: number }>("getBalance", [input.creatorWallet, { commitment: "finalized" }]);
  if (!Number.isSafeInteger(before.value) || !Number.isSafeInteger(before.context?.slot)) throw new Error("Creator balance is unavailable");
  const simulation = await solanaRpc<{ context: { slot: number }; value: { err: unknown; accounts?: Array<{ lamports: number } | null> } }>("simulateTransaction", [wire, { encoding: "base64", commitment: "finalized", minContextSlot: before.context.slot, sigVerify: false, accounts: { encoding: "base64", addresses: [input.creatorWallet] } }]);
  if (simulation.value?.err !== null) throw new Error(`Stonk creation simulation failed or was incomplete: ${JSON.stringify(simulation.value?.err)}. No transaction was sent.`);
  if (!Number.isSafeInteger(simulation.context?.slot)) throw new Error("Simulation context is unavailable");
  const after = simulation.value.accounts?.[0]?.lamports;
  const unchanged = await solanaRpc<{ value: number }>("getBalance", [input.creatorWallet, { commitment: "finalized", minContextSlot: simulation.context.slot }]);
  if (unchanged.value !== before.value) throw new Error("Creator balance changed during simulation. Prepare a fresh review.");
  if (!Number.isSafeInteger(after) || after! < 0 || after! >= before.value) throw new Error("Cannot verify Stonk creation cost");
  const metadata = { id: metadataId, image_data: input.logo,
    metadata: { name: input.name, symbol: input.symbol, description: input.description, image: `${uri}?image=1`, external_url: input.website, twitter: input.twitter, telegram: input.telegram } };
  const lamports = String(before.value - after!);
  const prepared: PreparedLaunch = {
    signedQuote: JSON.stringify({ venue: "stonkfun", method: "launchlab", mint: input.launchMint, pool: pool.toBase58(), metadataId, lastValidBlockHeight: latest.value.lastValidBlockHeight }),
    paymentTransaction: wire, payment: { lamports, sol: Number(lamports) / 1e9, recipient: LAUNCHLAB_PROGRAM },
    expiresAt: new Date(Date.now() + 75_000).toISOString(),
    raw: { creationMethod: "stonk_launchlab", mintSignerRequired: true, simulation: "passed", simulationSlot: simulation.context.slot,
      fundingMode: "creator_deposit", rewardAsset: "STONK", platform: pricing.platform.standard, pricing,
      baseTokenProgram: token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM, transferFeeEnabled: false,
      venueFees: { denominator: "1000000", protocolRate: configInfo.tradeFeeRate.toString(), platformRate: platformInfo.feeRate.toString(), creatorRate: platformInfo.creatorFeeRate.toString() },
      costDescription: "Simulated SOL debit for network fees and account rent. No initial buy. Venue fees come from Stonk's onchain configuration, not the TopBlast allocation." },
  };
  return { prepared, metadata };
}

export async function prepareStonkLaunch(input: LaunchDraft, verified: Awaited<ReturnType<typeof verifyStonkPricing>>): Promise<PreparedLaunch> {
  const { prepared, metadata } = await simulateStonkLaunch(input, verified);
  const { error } = await getAdminDb().from("launch_metadata").insert(metadata);
  if (error) throw error;
  return prepared;
}

export function isStonkDirectQuote(quote: string) {
  try { const parsed = JSON.parse(quote); return parsed.venue === "stonkfun" && parsed.method === "launchlab"; } catch { return false; }
}

export async function recoverStonkLaunch(signature: string, receipt: { signed_quote: string; signed_payment_transaction: string }): Promise<SubmittedLaunch> {
  const quote = z.object({ venue: z.literal("stonkfun"), method: z.literal("launchlab"), mint: publicKey, pool: publicKey, lastValidBlockHeight: z.number().int().positive().safe() }).parse(JSON.parse(receipt.signed_quote));
  if (await solanaRpc<string>("getGenesisHash") !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("Stonk recovery requires Solana mainnet");
  const tx = await solanaRpc<{ slot: number; meta: { err: unknown } | null; transaction: [string, string] } | null>("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  if (tx) {
    if (!tx.meta || tx.meta.err === undefined || !Number.isSafeInteger(tx.slot)) throw new Error("Stonk finalized transaction metadata unavailable");
    if (tx.transaction?.[0] !== receipt.signed_payment_transaction) throw new Error("Stonk finalized transaction does not match the saved receipt");
    return { status: tx.meta.err === null ? "completed" : "failed", paymentSignature: signature, mint: quote.mint, pool: quote.pool, signature, raw: { slot: tx.slot, error: tx.meta.err, creationMethod: "stonk_launchlab" } };
  }
  const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "finalized" }]);
  if (!Number.isSafeInteger(height)) throw new Error("Finalized block height unavailable");
  const status = await solanaRpc<{ value: Array<{ err: unknown; confirmationStatus: string } | null> }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  if (!Array.isArray(status.value) || status.value.length !== 1) throw new Error("Signature status unavailable");
  if (status.value[0] === null && height > quote.lastValidBlockHeight) return { status: "failed", paymentSignature: signature, raw: { reason: "Expired without landing; no new transaction was submitted" } };
  // The shared submission service durably stored and verified these exact signed bytes.
  // Never reconstruct, refresh the blockhash, or request another payment on retry.
  if (height <= quote.lastValidBlockHeight && receipt.signed_payment_transaction) await broadcastSignedCheckedTransfer(receipt.signed_payment_transaction).catch(() => undefined);
  return { status: "processing", paymentSignature: signature, raw: { confirmationStatus: status.value[0]?.confirmationStatus ?? "pending" } };
}
