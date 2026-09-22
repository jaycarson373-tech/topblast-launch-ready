import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { exactDatabaseFetch } from "@/lib/db/exact-json";

let client: SupabaseClient | null = null;

export function getAdminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: exactDatabaseFetch } });
  return client;
}

export function isDatabaseConfigured(): boolean {
  return Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
