import { notFound } from "next/navigation";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

export async function requirePublicLaunch(address: string) {
  if (!isDatabaseConfigured()) return;
  const { data, error } = await getAdminDb().from("launches").select("id").eq("mint", address).eq("is_test", false).maybeSingle();
  if (error) throw new Error("Launch visibility could not be verified");
  if (!data) notFound();
}
