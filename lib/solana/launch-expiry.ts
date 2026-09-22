import { solanaRpc } from "@/lib/solana/rpc";

// A review timer is only an estimate. Block height, not wall time, decides
// transaction expiry. Measure AFTER simulation; do not promise a fresh 75s.
export async function launchReviewExpiry(lastValidBlockHeight: number): Promise<string> {
  const height = await solanaRpc<number>("getBlockHeight", [{ commitment: "confirmed" }]);
  if (!Number.isSafeInteger(height) || height < 0 || !Number.isSafeInteger(lastValidBlockHeight)) throw new Error("Launch blockhash validity unavailable");
  const milliseconds = Math.min(50_000, (lastValidBlockHeight - height - 25) * 400);
  if (milliseconds < 20_000) throw new Error("Launch preparation took too long. Prepare a fresh review before signing. Nothing was submitted.");
  return new Date(Date.now() + milliseconds).toISOString();
}
