import { solanaRpc } from "@/lib/solana/rpc";
import { decodeFinalizedLaunchLabTransaction, type FinalizedBlockTransaction } from "@/lib/indexer/launchlab-decoder";
import { decodeFinalizedPumpTransaction } from "@/lib/indexer/pumpfun-decoder";

export interface PublicTrade { id: string; wallet: string; signature: string; kind: string; token_raw: string; quote_atoms: string | null; slot: number; block_time: string | null }
interface RecentTrades { trades: PublicTrade[]; available: boolean; partial: boolean }
const cache = new Map<string, { expires: number; result: Promise<RecentTrades> }>();

// Read-only display feed. Never writes positions, advances indexing cursors or
// certifies complete history. The ordered worker remains the accounting source.
export function recentTokenTrades(row: Record<string, unknown>): Promise<RecentTrades> {
  const key = JSON.stringify([row.launch_id, row.venue, row.market_address, row.base_mint, row.quote_mint, row.launch_slot]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  const result = readTrades(row).catch(() => ({ trades: [], available: false, partial: true }));
  cache.set(key, { expires: Date.now() + 4_000, result });
  return result;
}

async function readTrades(row: Record<string, unknown>): Promise<RecentTrades> {
  const signatures = await solanaRpc<Array<{ signature: string; slot: number; err: unknown }>>("getSignaturesForAddress", [row.market_address, { commitment: "finalized", limit: 25 }]);
  const market = { launchId: String(row.launch_id), marketAddress: String(row.market_address), baseMint: String(row.base_mint), quoteMint: String(row.quote_mint),
    authorityAddress: String(row.authority_address), creatorAddress: String(row.creator_address), configAddress: String(row.config_address),
    platformConfigAddress: String(row.platform_config_address), baseVault: String(row.base_vault), quoteVault: String(row.quote_vault), baseTokenProgram: String(row.base_token_program), quoteTokenProgram: String(row.quote_token_program) };
  const seen = new Set<string>();
  const candidates = signatures.filter(item => {
    if (item.err || item.slot < Number(row.launch_slot) || item.signature === row.launch_signature || seen.has(item.signature)) return false;
    seen.add(item.signature); return true;
  });
  const results = await Promise.allSettled(candidates.map(async item => {
    const tx = await solanaRpc<(FinalizedBlockTransaction & { slot: number; blockTime: number | null }) | null>("getTransaction", [item.signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
    if (!tx || tx.slot !== item.slot || tx.transaction.signatures[0] !== item.signature) throw new Error("Finalized trade receipt mismatch");
    const decoded = (row.venue === "pumpfun" ? decodeFinalizedPumpTransaction : decodeFinalizedLaunchLabTransaction)(tx, market, BigInt(tx.slot));
    return decoded.events.flatMap((event, index): PublicTrade[] => event.kind === "verified_buy" || event.kind === "sell" ? [{
      id: `${market.launchId}:${item.signature}:${index}`, signature: item.signature, wallet: event.wallet, kind: event.kind,
      token_raw: event.tokenRaw.toString(), quote_atoms: event.quoteAtoms?.toString() ?? null,
      slot: tx.slot, block_time: tx.blockTime == null ? null : new Date(tx.blockTime * 1000).toISOString(),
    }] : []);
  }));
  return { trades: results.flatMap(result => result.status === "fulfilled" ? result.value : []).sort((a, b) => b.slot - a.slot), available: true, partial: results.some(result => result.status === "rejected") };
}

export function mergeTokenTrades(indexed: PublicTrade[], recent: PublicTrade[]) {
  const receipts = new Set(recent.map(item => item.signature));
  return [...recent, ...indexed.filter(item => !receipts.has(item.signature))].sort((a, b) => b.slot - a.slot).slice(0, 100);
}
