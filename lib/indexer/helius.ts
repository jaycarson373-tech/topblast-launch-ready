import type { PositionEvent } from "@/lib/rewards/position";
import type { TrackedMarket } from "@/lib/types";

interface HeliusRawAmount { tokenAmount?: string; decimals?: number }
interface HeliusTokenTransfer {
  mint?: string;
  fromUserAccount?: string;
  toUserAccount?: string;
  tokenAmount?: number;
  rawTokenAmount?: HeliusRawAmount;
}
export interface HeliusEnhancedTransaction {
  signature?: string;
  slot?: number;
  type?: string;
  source?: string;
  feePayer?: string;
  tokenTransfers?: HeliusTokenTransfer[];
  accountData?: Array<{ account?: string }>;
  instructions?: Array<{ accounts?: string[]; innerInstructions?: Array<{ accounts?: string[] }> }>;
}

const allowedSwapSources = new Set(["RAYDIUM", "RAYDIUM_LAUNCHLAB", "RAYDIUM_CP"]);
const toRaw = (transfer: HeliusTokenTransfer): bigint => {
  if (transfer.rawTokenAmount?.tokenAmount) return BigInt(transfer.rawTokenAmount.tokenAmount);
  const decimals = transfer.rawTokenAmount?.decimals ?? 0;
  return BigInt(Math.round((transfer.tokenAmount ?? 0) * 10 ** decimals));
};

function mentionsMarket(transaction: HeliusEnhancedTransaction, marketAddress: string): boolean {
  if (transaction.accountData?.some((item) => item.account === marketAddress)) return true;
  return Boolean(transaction.instructions?.some((ix) =>
    ix.accounts?.includes(marketAddress) || ix.innerInstructions?.some((inner) => inner.accounts?.includes(marketAddress)),
  ));
}

export function parseHeliusActivity(
  transaction: HeliusEnhancedTransaction,
  market: TrackedMarket,
): { signature: string; events: PositionEvent[] } | null {
  if (!transaction.signature || transaction.slot === undefined) return null;
  const transfers = transaction.tokenTransfers ?? [];
  const slot = BigInt(transaction.slot);
  const events: PositionEvent[] = [];
  const swap = transaction.type === "SWAP" && allowedSwapSources.has(transaction.source ?? "") && mentionsMarket(transaction, market.marketAddress);

  if (swap) {
    const wallets = new Set(transfers.flatMap((transfer) => [transfer.fromUserAccount, transfer.toUserAccount]).filter(Boolean) as string[]);
    for (const wallet of wallets) {
      const baseIn = transfers.find((t) => t.mint === market.baseMint && t.toUserAccount === wallet);
      const quoteOut = transfers.find((t) => t.mint === market.quoteMint && t.fromUserAccount === wallet);
      if (baseIn && quoteOut) {
        events.push({ kind: "verified_buy", launchId: market.launchId, wallet, tokenRaw: toRaw(baseIn), quoteAtoms: toRaw(quoteOut), slot });
        continue;
      }
      const baseOut = transfers.find((t) => t.mint === market.baseMint && t.fromUserAccount === wallet);
      const quoteIn = transfers.find((t) => t.mint === market.quoteMint && t.toUserAccount === wallet);
      if (baseOut && quoteIn) events.push({ kind: "sell", launchId: market.launchId, wallet, tokenRaw: toRaw(baseOut), slot });
    }
  } else {
    for (const transfer of transfers.filter((item) => item.mint === market.baseMint)) {
      const tokenRaw = toRaw(transfer);
      if (tokenRaw <= 0n) continue;
      if (transfer.fromUserAccount) events.push({ kind: "outgoing_transfer", launchId: market.launchId, wallet: transfer.fromUserAccount, tokenRaw, slot });
      if (transfer.toUserAccount) events.push({ kind: "incoming_transfer", launchId: market.launchId, wallet: transfer.toUserAccount, tokenRaw, slot });
    }
  }
  return events.length ? { signature: transaction.signature, events } : null;
}

export async function fetchEnhancedTransaction(signature: string): Promise<HeliusEnhancedTransaction | null> {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not configured");
  const response = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: [signature] }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Helius returned HTTP ${response.status}`);
  const data = await response.json() as HeliusEnhancedTransaction[];
  return data[0] ?? null;
}
