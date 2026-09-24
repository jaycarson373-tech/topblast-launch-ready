import type { SupabaseClient } from "@supabase/supabase-js";

export const STONK_ATTRIBUTION_BLOCKER = "Stonk combines creator-fee forwards across tokens. A venue-authenticated per-token payment breakdown is required before automatic reward funding can be credited.";

// Stonk's standard LaunchLab trading fees go to its shared platform vault.
// Later forwards are creator/quote aggregates, not pool-vault payments.
// A pool-vault -> treasury transfer can simply be proceeds from a treasury
// sell. Neither that transfer nor a balance increase proves creator revenue.
// Do not restore automatic credits until an authenticated allocation can be
// matched to a finalized payment, reconciled exactly, and consumed once.
export async function reconcileStonkForwardedFees(_db: SupabaseClient, _market: { launch_id: string }) {
  void _db; void _market;
  return { credited: 0, status: "attribution_required" as const, reason: STONK_ATTRIBUTION_BLOCKER };
}
