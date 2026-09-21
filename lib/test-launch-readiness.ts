import { getAdminDb } from "@/lib/db/server";
import { runtimeReadiness } from "@/lib/readiness";

// Only called after operator authentication. This does not open public creation.
export async function assertTestLaunchReady() {
  const readiness = runtimeReadiness();
  if (readiness.missing.length) throw new Error(`Missing: ${readiness.missing.join(", ")}`);
  const db = getAdminDb();
  const { error } = await db.from("launches").select("is_test").limit(1);
  if (error) throw new Error("Apply the test-launch visibility migration before preparing a test");
  const heartbeat = await db.from("system_config").select("value").eq("key", "worker_heartbeat").single();
  const value = heartbeat.data?.value;
  if (heartbeat.error || value?.pipeline !== "operational" || !value?.at || !(Date.now() - new Date(value.at).getTime() < 180_000)) {
    throw new Error("A healthy operational worker is required for a test launch");
  }
}
