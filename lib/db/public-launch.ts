import { notFound } from "next/navigation";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

export async function requirePublicLaunch(address: string) {
  if (!isDatabaseConfigured()) return;
  const { data, error } = await getAdminDb().from("launches").select("id").eq("mint", address).eq("listing_hidden", false).or("is_test.eq.false,public_test_listing.eq.true").in("status", ["active", "paused"]).maybeSingle();
  if (error) throw new Error("Launch visibility could not be verified");
  if (!data) notFound();
}
