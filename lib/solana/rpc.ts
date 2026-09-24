import { isAddress } from "@solana/addresses";

type RpcEnvelope<T> = { jsonrpc?: string; id?: number; result?: T; error?: { code: number; message: string } };

export function solanaRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY)}`;
  throw new Error("SOLANA_RPC_URL or HELIUS_API_KEY is required");
}

export async function solanaRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(solanaRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const body = await response.json() as RpcEnvelope<T>;
      if (!body.error) {
        if (body.result === undefined) throw new Error("Solana RPC returned no result");
        return body.result;
      }
      // A load-balanced node can lag a finalized context returned by another node.
      // Retry the exact request, never remove minContextSlot or weaken commitment.
      if (body.error.code === -32016 && attempt === 4) throw new Error("Solana RPC is still catching up to the required finalized slot. Retry the same action shortly; keep any existing payment receipt.");
      if (![-32005, -32016].includes(body.error.code) || attempt === 4) throw new Error(`Solana RPC ${body.error.code}: ${body.error.message}`);
    } else if ((response.status !== 429 && response.status < 500) || attempt === 4) {
      throw new Error(`Solana RPC returned HTTP ${response.status}`);
    }
    // json() already consumed and locked the stream on JSON-RPC error responses.
    if (!response.bodyUsed) await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error("Solana RPC retry exhausted");
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
  const balance = await solanaRpc<{ value: number }>("getBalance", [owner, { commitment: "finalized" }]);
  let rewardAtoms: string | null = null;
  if (rewardMint) {
    const accounts = await solanaRpc<{ value: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }>(
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
