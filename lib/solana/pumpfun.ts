import { PUMP_SDK, PUMP_PROGRAM_ID, bondingCurvePda, GLOBAL_PDA } from "./pump-sdk";
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
  if (!curve.quoteMint.equals(PublicKey.default) && !curve.quoteMint.equals(NATIVE_MINT)) throw new Error("Only SOL-paired Pump.fun curves are supported");
  if (curve.isMayhemMode || curve.isCashbackCoin || curve.isHolderReward) throw new Error("Unsupported Pump.fun reward or trading mode");
  return { curve, slot: response.context.slot };
}

export async function inspectPumpMarket(input: { mint: string; pool: string; quoteMint: string; creator: string; launchSignature?: string | null }) {
  if (input.quoteMint !== PUMP_SOL_MINT) throw new Error("Pump.fun requires the SOL quote mint");
  const { curve } = await readPumpCurve(input.mint, input.pool);
  if (![input.creator, process.env.TOPBLAST_TREASURY_ADDRESS].includes(curve.creator.toBase58())) throw new Error("Pump.fun creator identity mismatch");
  const mint = await solanaRpc<{ value: { owner: string; data: { parsed: { type: string; info: { decimals: number } } } } | null }>("getAccountInfo", [input.mint, { encoding: "jsonParsed", commitment: "finalized" }]);
  if (mint.value?.owner !== TOKEN_2022_PROGRAM_ID.toBase58() || mint.value.data?.parsed?.type !== "mint" || mint.value.data.parsed.info.decimals !== 6) throw new Error("Unexpected Pump.fun mint program or decimals");
  if (!input.launchSignature) throw new Error("Finalized creation signature is required");
  const tx = await solanaRpc<{ slot: number; meta: { err: unknown } | null } | null>("getTransaction", [input.launchSignature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (!tx?.meta || tx.meta.err || !Number.isSafeInteger(tx.slot)) throw new Error("Pump.fun launch has not finalized");
  return {
    programId: PUMP_PROGRAM_ID.toBase58(), launchSlot: tx.slot, baseDecimals: 6, quoteDecimals: 9,
    baseTokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(), quoteTokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    authorityAddress: input.pool, creatorAddress: curve.creator.toBase58(), configAddress: GLOBAL_PDA.toBase58(), platformConfigAddress: GLOBAL_PDA.toBase58(),
    baseVault: getAssociatedTokenAddressSync(new PublicKey(input.mint), new PublicKey(input.pool), true, TOKEN_2022_PROGRAM_ID).toBase58(),
    quoteVault: input.pool,
  };
}

export async function observePumpPrice(market: { marketAddress: string; baseMint: string; creatorAddress: string; tokenDecimals: number }) {
  const { curve, slot } = await readPumpCurve(market.baseMint, market.marketAddress);
  if (curve.creator.toBase58() !== market.creatorAddress) throw new Error("Pump.fun price creator changed");
  const base = BigInt(curve.virtualTokenReserves.toString()), quote = BigInt(curve.virtualQuoteReserves.toString());
  if (base <= 0n || quote <= 0n) throw new Error("Invalid Pump.fun virtual reserves");
  const blockTime = await solanaRpc<number | null>("getBlockTime", [slot]);
  if (!Number.isSafeInteger(blockTime)) throw new Error("Finalized Pump.fun timestamp unavailable");
  const priceQuoteAtomsPerToken = quote * 10n ** BigInt(market.tokenDecimals) / base;
  if (priceQuoteAtomsPerToken <= 0n) throw new Error("Pump.fun price rounds to zero");
  return { slot, blockTime: new Date(blockTime! * 1000).toISOString(), priceQuoteAtomsPerToken };
}
