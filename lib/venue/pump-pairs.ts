import { PublicKey } from "@solana/web3.js";
import { PUMP_SOL_MINT } from "@/lib/solana/pumpfun";
import type { VenuePair } from "./launch-venue-adapter";

const PUMP_CUSTOM_PAIRS_URL = "https://pump.fun/docs/custom-pairs";
const SOL_PAIR: VenuePair = { mint: PUMP_SOL_MINT, symbol: "SOL", name: "Solana", decimals: 9, launchable: true };

function text(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}

export async function listOfficialPumpPairs(): Promise<VenuePair[]> {
  const response = await fetch(PUMP_CUSTOM_PAIRS_URL, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Pump.fun pair catalog returned HTTP ${response.status}`);
  const html = await response.text();
  const pairs = new Map<string, VenuePair>();
  for (const row of html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => text(match[1]));
    if (cells.length < 5) continue;
    const [symbol, name, , , mint] = cells;
    try {
      if (!symbol || !name || new PublicKey(mint).toBase58() !== mint) continue;
      pairs.set(mint, { mint, symbol: symbol.slice(0, 20), name: name.slice(0, 80), decimals: mint === PUMP_SOL_MINT ? 9 : 0, launchable: true });
    } catch { /* Ignore malformed rows from the public documentation page. */ }
  }
  if (!pairs.has(PUMP_SOL_MINT)) pairs.set(PUMP_SOL_MINT, SOL_PAIR);
  if (pairs.size < 2) throw new Error("Pump.fun returned an incomplete supported-pair catalog");
  return [...pairs.values()].sort((a, b) => a.mint === PUMP_SOL_MINT ? -1 : b.mint === PUMP_SOL_MINT ? 1 : a.symbol.localeCompare(b.symbol));
}

export async function officialPumpPair(mint: string) {
  if (mint === PUMP_SOL_MINT) return SOL_PAIR;
  return (await listOfficialPumpPairs()).find((pair) => pair.mint === mint) ?? null;
}
