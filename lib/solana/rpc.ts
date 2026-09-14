import "server-only";
import { isAddress } from "@solana/addresses";

type RpcEnvelope<T> = { jsonrpc?: string; id?: number; result?: T; error?: { code: number; message: string } };

function rpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`;
  throw new Error("SOLANA_RPC_URL or HELIUS_API_KEY is required");
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}`);
  const body = await response.json() as RpcEnvelope<T>;
  if (body.error) throw new Error(`Solana RPC ${body.error.code}: ${body.error.message}`);
  if (body.result === undefined) throw new Error("Solana RPC returned no result");
  return body.result;
}

export interface TreasuryBalance {
  address: string;
  solLamports: string;
  sol: number;
  rewardMint: string | null;
  rewardAtoms: string | null;
}

export async function getTreasuryBalance(owner: string, rewardMint?: string): Promise<TreasuryBalance> {
  if (!isAddress(owner)) throw new Error("Treasury address is not a valid Solana address");
  if (rewardMint && !isAddress(rewardMint)) throw new Error("Reward mint is not a valid Solana address");
  const balance = await rpc<{ value: number }>("getBalance", [owner, { commitment: "finalized" }]);
  let rewardAtoms: string | null = null;
  if (rewardMint) {
    const accounts = await rpc<{ value: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }>(
      "getTokenAccountsByOwner",
      [owner, { mint: rewardMint }, { encoding: "jsonParsed", commitment: "finalized" }],
    );
    rewardAtoms = accounts.value.reduce((sum, item) => {
      const amount = item.account?.data?.parsed?.info?.tokenAmount?.amount;
      return sum + (amount ? BigInt(amount) : 0n);
    }, 0n).toString();
  }
  return {
    address: owner,
    solLamports: String(balance.value),
    sol: balance.value / 1_000_000_000,
    rewardMint: rewardMint ?? null,
    rewardAtoms,
  };
}

