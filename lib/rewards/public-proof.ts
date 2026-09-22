export interface PublicAllocation { epoch_id: string; wallet: string; amount_atoms: string }
export interface PublicDistribution extends PublicAllocation { status: string; signature: string | null }

/** Payment is established per recipient, never inferred from another batch in the epoch. */
export function allocationReceipt(allocation: PublicAllocation, distributions: PublicDistribution[]) {
  const payment = distributions.find((row) => row.epoch_id === allocation.epoch_id && row.wallet === allocation.wallet);
  const confirmed = payment?.status === "confirmed" && Boolean(payment.signature) && payment.amount_atoms === allocation.amount_atoms;
  return { status: confirmed ? "PAYOUT CONFIRMED" : payment?.status === "failed" ? "PAYOUT FAILED" : payment?.status === "submitted" ? "SUBMITTED · NOT PAID" : "REWARD RESERVED", signature: payment?.signature ?? null, paidAtoms: confirmed ? allocation.amount_atoms : "0" };
}
