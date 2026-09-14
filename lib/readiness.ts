import { isDatabaseConfigured } from "@/lib/db/server";

const requiredRuntimeVariables = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "HELIUS_API_KEY",
  "HELIUS_WEBHOOK_SECRET",
  "TOPBLAST_TREASURY_ADDRESS",
  "PROTOCOL_TREASURY_ADDRESS",
] as const;

export function runtimeReadiness() {
  const missing: string[] = requiredRuntimeVariables.filter((name) => !process.env[name]);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) missing.unshift("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
  const launchesEnabled = process.env.LAUNCHES_ENABLED === "true";
  return {
    database: isDatabaseConfigured(),
    indexer: Boolean(process.env.HELIUS_API_KEY && process.env.HELIUS_WEBHOOK_SECRET),
    treasury: Boolean(process.env.TOPBLAST_TREASURY_ADDRESS && process.env.PROTOCOL_TREASURY_ADDRESS),
    dryRun: process.env.DRY_RUN !== "false",
    launchesEnabled,
    launchReady: launchesEnabled && missing.length === 0,
    missing,
  };
}

export function assertLaunchReady(): void {
  const readiness = runtimeReadiness();
  if (!readiness.launchReady) {
    const reason = readiness.missing.length ? `Missing: ${readiness.missing.join(", ")}` : "LAUNCHES_ENABLED is not true";
    throw new Error(`Launches are not activated. ${reason}`);
  }
}
