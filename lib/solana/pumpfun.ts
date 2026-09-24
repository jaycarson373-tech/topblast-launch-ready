import { PUMP_SDK, PUMP_PROGRAM_ID, bondingCurvePda, feeSharingConfigPda, GLOBAL_PDA } from "./pump-sdk";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { solanaRpc } from "./rpc";

export const PUMP_SOL_MINT = NATIVE_MINT.toBase58();
export { PUMP_PROGRAM_ID };
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export async function assertPumpMainnet() {
  if (await solanaRpc<string>("getGenesisHash") !== MAINNET_GENESIS) throw new Error("Pump.fun integration requires Solana mainnet. No transaction was submitted.");
}

export async function pumpCreationAvailable() {
  await assertPumpMainnet();
  const response = await solanaRpc<{ value: { owner: string; data: [string, string]; lamports: number; executable: boolean } | null }>("getAccountInfo", [GLOBAL_PDA.toBase58(), { encoding: "base64", commitment: "finalized" }]);
  const account = response.value;
  if (!account || account.owner !== PUMP_PROGRAM_ID.toBase58() || account.executable || account.data?.[1] !== "base64") throw new Error("Pump.fun global account could not be verified");
  const global = PUMP_SDK.decodeGlobal({ ...account, owner: PUMP_PROGRAM_ID, data: Buffer.from(account.data[0], "base64") });
  return global.initialized === true && global.createV2Enabled === true;
}

export async function readPumpCurve(mint: string, expectedPool: string) {
  const pool = bondingCurvePda(new PublicKey(mint));
  if (pool.toBase58() !== expectedPool) throw new Error("Pump.fun curve address mismatch");
  const response = await solanaRpc<{ context: { slot: number }; value: { owner: string; data: [string, string]; lamports: number; executable: boolean } | null }>("getAccountInfo", [expectedPool, { encoding: "base64", commitment: "finalized" }]);
  if (!response.value || response.value.owner !== PUMP_PROGRAM_ID.toBase58() || response.value.executable || response.value.data[1] !== "base64" || !Number.isSafeInteger(response.context.slot)) throw new Error("Unverified Pump.fun curve account");
  const curve = PUMP_SDK.decodeBondingCurve({ ...response.value, owner: PUMP_PROGRAM_ID, data: Buffer.from(response.value.data[0], "base64") });
  if (curve.complete) throw new Error("Pump.fun curve graduated. Rewards paused until the graduated market is verified.");
  if (curve.isMayhemMode || curve.isCashbackCoin || curve.isHolderReward) throw new Error("Unsupported Pump.fun reward or trading mode");
  return { curve, slot: response.context.slot };
}

export function normalizedPumpQuote(mint: PublicKey) {
  return mint.equals(PublicKey.default) || mint.equals(NATIVE_MINT) ? NATIVE_MINT : mint;
}

export async function inspectPumpQuoteMint(mint: string) {
  if (mint === PUMP_SOL_MINT) return { decimals: 9, tokenProgram: TOKEN_PROGRAM_ID };
  const response = await solanaRpc<{ value: { owner: string; data: { parsed?: { type?: string; info?: { decimals?: number } } }; executable: boolean } | null }>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "finalized" }]);
  const owner = response.value?.owner;
  const decimals = response.value?.data?.parsed?.info?.decimals;
  if (!response.value || response.value.executable || response.value.data?.parsed?.type !== "mint" || !Number.isInteger(decimals) || Number(decimals) < 0 || Number(decimals) > 18 || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(String(owner))) throw new Error("Pump.fun quote mint is not a verified SPL mint");
  return { decimals: Number(decimals), tokenProgram: new PublicKey(owner!) };
}

export async function inspectPumpMarket(input: { mint: string; pool: string; quoteMint: string; creator: string; launchSignature?: string | null }) {
  const { curve } = await readPumpCurve(input.mint, input.pool);
  if (normalizedPumpQuote(curve.quoteMint).toBase58() !== input.quoteMint) throw new Error("Pump.fun curve quote mint mismatch");
  if (![input.creator, process.env.TOPBLAST_TREASURY_ADDRESS, feeSharingConfigPda(new PublicKey(input.mint)).toBase58()].includes(curve.creator.toBase58())) throw new Error("Pump.fun creator identity mismatch");
  const mint = await solanaRpc<{ value: { owner: string; data: { parsed: { type: string; info: { decimals: number } } } } | null }>("getAccountInfo", [input.mint, { encoding: "jsonParsed", commitment: "finalized" }]);
  if (mint.value?.owner !== TOKEN_2022_PROGRAM_ID.toBase58() || mint.value.data?.parsed?.type !== "mint" || mint.value.data.parsed.info.decimals !== 6) throw new Error("Unexpected Pump.fun mint program or decimals");
  if (!input.launchSignature) throw new Error("Finalized creation signature is required");
  const tx = await solanaRpc<{ slot: number; meta: { err: unknown } | null } | null>("getTransaction", [input.launchSignature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (!tx?.meta || tx.meta.err || !Number.isSafeInteger(tx.slot)) throw new Error("Pump.fun launch has not finalized");
  const quote = await inspectPumpQuoteMint(input.quoteMint);
  const quoteIsSol = input.quoteMint === PUMP_SOL_MINT;
  return {
    programId: PUMP_PROGRAM_ID.toBase58(), launchSlot: tx.slot, baseDecimals: 6, quoteDecimals: quote.decimals,
    baseTokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(), quoteTokenProgram: quote.tokenProgram.toBase58(),
    authorityAddress: input.pool, creatorAddress: curve.creator.toBase58(), configAddress: GLOBAL_PDA.toBase58(), platformConfigAddress: GLOBAL_PDA.toBase58(),
    baseVault: getAssociatedTokenAddressSync(new PublicKey(input.mint), new PublicKey(input.pool), true, TOKEN_2022_PROGRAM_ID).toBase58(),
    quoteVault: quoteIsSol ? input.pool : getAssociatedTokenAddressSync(new PublicKey(input.quoteMint), new PublicKey(input.pool), true, quote.tokenProgram).toBase58(),
  };
}

export async function observePumpPrice(market: { marketAddress: string; baseMint: string; quoteMint: string; creatorAddress: string; tokenDecimals: number }) {
  const { curve, slot } = await readPumpCurve(market.baseMint, market.marketAddress);
  if (normalizedPumpQuote(curve.quoteMint).toBase58() !== market.quoteMint) throw new Error("Pump.fun price quote mint changed");
  if (![market.creatorAddress, feeSharingConfigPda(new PublicKey(market.baseMint)).toBase58()].includes(curve.creator.toBase58())) throw new Error("Pump.fun price creator changed");
  const base = BigInt(curve.virtualTokenReserves.toString()), quote = BigInt(curve.virtualQuoteReserves.toString());
  if (base <= 0n || quote <= 0n) throw new Error("Invalid Pump.fun virtual reserves");
  const blockTime = await solanaRpc<number | null>("getBlockTime", [slot]);
  if (!Number.isSafeInteger(blockTime)) throw new Error("Finalized Pump.fun timestamp unavailable");
  const priceQuoteAtomsPerToken = quote * 10n ** BigInt(market.tokenDecimals) / base;
  if (priceQuoteAtomsPerToken <= 0n) throw new Error("Pump.fun price rounds to zero");
  return { slot, blockTime: new Date(blockTime! * 1000).toISOString(), priceQuoteAtomsPerToken };
}
