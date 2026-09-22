import { PublicKey } from "@solana/web3.js";
import { solanaRpc } from "@/lib/solana/rpc";
import { LAUNCHLAB_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/launchlab-constants";

export { LAUNCHLAB_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM };
const POOL_DISCRIMINATOR = Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]);

type AccountResponse = { context: { slot: number }; value: { owner: string; data: [string, "base64"] } | null };
type ParsedAccount = { value: { owner: string; data?: { parsed?: { type?: string; info?: Record<string, unknown> } } } | null };

const keyAt = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32)).toBase58();

function decodePool(value: AccountResponse["value"]) {
  if (!value || value.owner !== LAUNCHLAB_PROGRAM || !Array.isArray(value.data) || value.data[1] !== "base64") throw new Error("Unverified LaunchLab pool account");
  const data = Buffer.from(value.data[0], "base64");
  if (data.length !== 429 || !data.subarray(0, 8).equals(POOL_DISCRIMINATOR)) throw new Error("Unexpected LaunchLab pool layout");
  if (data[17] !== 0 || data[365] > 3) throw new Error("Migrated or unsupported LaunchLab pool");
  return {
    data,
    configAddress: keyAt(data, 141),
    platformConfigAddress: keyAt(data, 173),
    baseMint: keyAt(data, 205),
    quoteMint: keyAt(data, 237),
    baseVault: keyAt(data, 269),
    quoteVault: keyAt(data, 301),
    creatorAddress: keyAt(data, 333),
    tokenProgramFlag: data[365],
  };
}

async function parsedAccount(address: string) {
  const result = await solanaRpc<ParsedAccount>("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "finalized" }]);
  if (!result.value) throw new Error(`Required account ${address} is missing`);
  return result.value;
}

export async function inspectLaunchLabMarket(input: { pool: string; mint: string; quoteMint: string; creator: string; launchSignature?: string | null }) {
  const response = await solanaRpc<AccountResponse>("getAccountInfo", [input.pool, { encoding: "base64", commitment: "finalized" }]);
  if (!Number.isSafeInteger(response.context?.slot)) throw new Error("LaunchLab pool context slot is missing");
  const pool = decodePool(response.value);
  if (pool.baseMint !== input.mint || pool.quoteMint !== input.quoteMint || pool.creatorAddress !== input.creator) throw new Error("LaunchLab pool identity mismatch");
  const [baseMint, quoteMint, baseVault, quoteVault, config, platform] = await Promise.all([
    parsedAccount(pool.baseMint), parsedAccount(pool.quoteMint), parsedAccount(pool.baseVault), parsedAccount(pool.quoteVault),
    solanaRpc<ParsedAccount>("getAccountInfo", [pool.configAddress, { encoding: "base64", commitment: "finalized" }]),
    solanaRpc<ParsedAccount>("getAccountInfo", [pool.platformConfigAddress, { encoding: "base64", commitment: "finalized" }]),
  ]);
  if (config.value?.owner !== LAUNCHLAB_PROGRAM || platform.value?.owner !== LAUNCHLAB_PROGRAM) throw new Error("LaunchLab configuration ownership mismatch");
  const baseInfo = baseMint.data?.parsed?.info as { decimals?: number } | undefined;
  const quoteInfo = quoteMint.data?.parsed?.info as { decimals?: number } | undefined;
  const baseVaultInfo = baseVault.data?.parsed?.info as { mint?: string; owner?: string } | undefined;
  const quoteVaultInfo = quoteVault.data?.parsed?.info as { mint?: string; owner?: string } | undefined;
  if (baseMint.data?.parsed?.type !== "mint" || quoteMint.data?.parsed?.type !== "mint") throw new Error("LaunchLab mint parsing failed");
  if (!Number.isInteger(baseInfo?.decimals) || !Number.isInteger(quoteInfo?.decimals)) throw new Error("LaunchLab mint decimals unavailable");
  if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(baseMint.owner) || ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(quoteMint.owner)) throw new Error("Unsupported token program");
  const expectedProgramFlag = (baseMint.owner === TOKEN_2022_PROGRAM ? 1 : 0) | (quoteMint.owner === TOKEN_2022_PROGRAM ? 2 : 0);
  if (pool.tokenProgramFlag !== expectedProgramFlag) throw new Error("LaunchLab token program flag mismatch");
  if (baseVaultInfo?.mint !== pool.baseMint || quoteVaultInfo?.mint !== pool.quoteMint || !baseVaultInfo.owner || baseVaultInfo.owner !== quoteVaultInfo.owner) throw new Error("LaunchLab vault identity mismatch");
  let launchSlot = response.context.slot;
  if (input.launchSignature) {
    const transaction = await solanaRpc<{ slot?: number } | null>("getTransaction", [input.launchSignature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (transaction?.slot && Number.isSafeInteger(transaction.slot)) launchSlot = transaction.slot;
  }
  return {
    programId: LAUNCHLAB_PROGRAM,
    launchSlot,
    baseDecimals: baseInfo!.decimals!,
    quoteDecimals: quoteInfo!.decimals!,
    baseTokenProgram: baseMint.owner,
    quoteTokenProgram: quoteMint.owner,
    authorityAddress: baseVaultInfo.owner,
    ...pool,
  };
}

export async function observeLaunchLabPrice(market: {
  launchId: string; marketAddress: string; baseMint: string; quoteMint: string; creatorAddress: string;
  configAddress: string; platformConfigAddress: string; baseVault: string; quoteVault: string; tokenDecimals: number;
  baseTokenProgram: string; quoteTokenProgram: string;
}) {
  const response = await solanaRpc<AccountResponse>("getAccountInfo", [market.marketAddress, { encoding: "base64", commitment: "finalized" }]);
  const pool = decodePool(response.value);
  if (pool.baseMint !== market.baseMint || pool.quoteMint !== market.quoteMint || pool.creatorAddress !== market.creatorAddress || pool.configAddress !== market.configAddress || pool.platformConfigAddress !== market.platformConfigAddress || pool.baseVault !== market.baseVault || pool.quoteVault !== market.quoteVault) throw new Error("LaunchLab price account identity mismatch");
  const expectedProgramFlag = (market.baseTokenProgram === TOKEN_2022_PROGRAM ? 1 : 0) | (market.quoteTokenProgram === TOKEN_2022_PROGRAM ? 2 : 0);
  if (pool.tokenProgramFlag !== expectedProgramFlag) throw new Error("LaunchLab price token program flag mismatch");
  // Official LaunchConstantProductCurve.getPoolPrice uses virtualB + realB
  // over virtualA - realA. Virtual reserves alone are only the initial price.
  const virtualBase = pool.data.readBigUInt64LE(37) - pool.data.readBigUInt64LE(53);
  const virtualQuote = pool.data.readBigUInt64LE(45) + pool.data.readBigUInt64LE(61);
  if (virtualBase <= 0n || virtualQuote <= 0n) throw new Error("Invalid LaunchLab effective reserves");
  const blockTime = await solanaRpc<number | null>("getBlockTime", [response.context.slot]);
  if (!Number.isSafeInteger(blockTime)) throw new Error("Finalized price timestamp unavailable");
  const priceQuoteAtomsPerToken = virtualQuote * 10n ** BigInt(market.tokenDecimals) / virtualBase;
  if (priceQuoteAtomsPerToken <= 0n) throw new Error("Invalid LaunchLab price");
  return { slot: response.context.slot, blockTime: new Date(blockTime! * 1000).toISOString(), priceQuoteAtomsPerToken };
}
