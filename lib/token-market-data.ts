import { observeLaunchLabPrice } from "@/lib/solana/launchlab";
import { observePumpPrice } from "@/lib/solana/pumpfun";
import { solanaRpc } from "@/lib/solana/rpc";

export interface TokenMarketData {
  status: "available" | "unavailable"; error?: string;
  priceAtoms?: string; priceUsd?: number | null; marketCapUsd?: number | null;
  supplyRaw?: string; supplyDecimals?: number; marketCapQuoteAtoms?: string;
  slot?: number; observedAt?: string; usdObservedAt?: string | null;
}

// Display-only spot data. Never use this response as an eligibility snapshot.
export async function tokenMarketData(row: Record<string, unknown>): Promise<TokenMarketData> {
  try {
    const market = { launchId: String(row.launch_id), marketAddress: String(row.market_address), baseMint: String(row.base_mint), quoteMint: String(row.quote_mint),
      creatorAddress: String(row.creator_address), configAddress: String(row.config_address), platformConfigAddress: String(row.platform_config_address),
      baseVault: String(row.base_vault), quoteVault: String(row.quote_vault), tokenDecimals: Number(row.base_decimals),
      baseTokenProgram: String(row.base_token_program), quoteTokenProgram: String(row.quote_token_program) };
    const observation = await (row.venue === "pumpfun" ? observePumpPrice : observeLaunchLabPrice)(market);
    const supply = await solanaRpc<{ value: { amount: string; decimals: number } }>("getTokenSupply", [market.baseMint, { commitment: "finalized", minContextSlot: observation.slot }]);
    if (!/^\d+$/.test(supply.value?.amount) || supply.value.decimals !== market.tokenDecimals) throw new Error("Mint supply could not be verified");
    const capAtoms = observation.priceQuoteAtomsPerToken * BigInt(supply.value.amount) / 10n ** BigInt(market.tokenDecimals);
    let quoteUsd: number | null = null, usdObservedAt: string | null = null;
    // Official venue quote-asset conversion, separately timestamped. Failure
    // leaves native quote prices visible and USD values unavailable, not zero.
    try {
      const response = await fetch(`https://www.stonkfun.xyz/api/public/v1/launchlab/pricing?quoteMint=${encodeURIComponent(market.quoteMint)}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5_000) });
      const body = await response.json();
      const data = body.data;
      const age = Date.now() - Date.parse(data?.prices?.observedAt);
      if (response.ok && data?.quote?.mint === market.quoteMint && Number.isFinite(age) && age >= -30_000 && age <= 180_000 && typeof data.prices.quoteUsd === "number" && Number.isFinite(data.prices.quoteUsd) && data.prices.quoteUsd > 0) {
        quoteUsd = data.prices.quoteUsd; usdObservedAt = data.prices.observedAt;
      }
    } catch { /* Native quote data remains usable. */ }
    const scale = 10 ** Number(row.quote_decimals);
    const priceUsd = quoteUsd === null ? null : Number(observation.priceQuoteAtomsPerToken) / scale * quoteUsd;
    const marketCapUsd = quoteUsd === null ? null : Number(capAtoms) / scale * quoteUsd;
    return { status: "available", priceAtoms: observation.priceQuoteAtomsPerToken.toString(), slot: observation.slot, observedAt: observation.blockTime,
      supplyRaw: supply.value.amount, supplyDecimals: supply.value.decimals, marketCapQuoteAtoms: capAtoms.toString(),
      priceUsd: priceUsd !== null && Number.isFinite(priceUsd) ? priceUsd : null, marketCapUsd: marketCapUsd !== null && Number.isFinite(marketCapUsd) ? marketCapUsd : null, usdObservedAt };
  } catch (error) { return { status: "unavailable", error: error instanceof Error ? error.message : "Market observation unavailable" }; }
}
