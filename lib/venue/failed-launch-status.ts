import { isAddress } from "@solana/addresses";
import { getAdminDb } from "@/lib/db/server";
import { solanaRpc } from "@/lib/solana/rpc";

// Read-only. A stored failure alone must never unlock another payment.
export async function failedLaunchStatus(launchId: string, paymentSignature: string, reason: unknown) {
  const result = { launchId, paymentSignature, status: "failed", retrySafe: false,
    failureMessage: "Launch failed. Keep this receipt. Verify the transaction before starting another launch." };
  if (typeof reason !== "string" || !reason.startsWith("Expired without landing;")) return result;
  result.failureMessage = "The saved transaction expired. Checking that it did not land is required before another launch.";
  try {
    const { data, error } = await getAdminDb().from("launch_submission_receipts").select("signed_quote,payment_signature").eq("launch_id", launchId).single();
    if (error || data?.payment_signature !== paymentSignature) return result;
    const quote = JSON.parse(data.signed_quote);
    if (!((quote.venue === "stonkfun" && quote.method === "launchlab") || quote.venue === "pumpfun") || !isAddress(quote.mint) || !Number.isSafeInteger(quote.lastValidBlockHeight)) return result;
    if (await solanaRpc<string>("getGenesisHash") !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") return result;
    const epoch = await solanaRpc<{ blockHeight: number; absoluteSlot: number }>("getEpochInfo", [{ commitment: "finalized" }]);
    if (!Number.isSafeInteger(epoch.blockHeight) || !Number.isSafeInteger(epoch.absoluteSlot) || epoch.blockHeight <= quote.lastValidBlockHeight) return result;
    const status = await solanaRpc<{ context: { slot: number }; value: unknown[] }>("getSignatureStatuses", [[paymentSignature], { searchTransactionHistory: true }]);
    if (!Number.isSafeInteger(status.context?.slot) || status.context.slot < epoch.absoluteSlot || status.value?.length !== 1 || status.value[0] !== null) return result;
    const mint = await solanaRpc<{ context: { slot: number }; value: unknown }>("getAccountInfo", [quote.mint, { commitment: "finalized", minContextSlot: epoch.absoluteSlot, encoding: "base64" }]);
    if (!Number.isSafeInteger(mint.context?.slot) || mint.context.slot < epoch.absoluteSlot || mint.value !== null) return result;
    return { ...result, retrySafe: true, failureMessage: "Expired without landing. The transaction and token were not found onchain after expiry. No launch payment was recorded. You can prepare a new review." };
  } catch {
    return { ...result, failureMessage: "The saved transaction expired, but the onchain safety check is unavailable. Keep this receipt and check again. Do not pay again yet." };
  }
}
