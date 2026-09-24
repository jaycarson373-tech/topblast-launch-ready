import { isAddress } from "@solana/addresses";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

/** Only a registered, public token with an actual creation receipt can be featured. */
export async function registeredFeaturedToken(): Promise<string | undefined> {
  if (!isDatabaseConfigured()) return;
  try {
  const db = getAdminDb();
  let mint = process.env.FEATURED_TOKEN_MINT;
  if (!mint) {
    const saved = await db.from("system_config").select("value").eq("key", "topblast_registered_mint").abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    if (saved.error || typeof saved.data?.value !== "string") return;
    mint = saved.data.value;
  }
  if (!isAddress(mint)) return;
  const { data, error } = await db.from("launches").select("mint,launch_signature").eq("mint", mint).eq("is_test", false).eq("listing_hidden", false).in("status", ["active", "paused"]).abortSignal(AbortSignal.timeout(3000)).maybeSingle();
  if (!error && data?.launch_signature) return data.mint;
  } catch {
    // An optional navigation badge must not take down every public route.
    return;
  }
}
