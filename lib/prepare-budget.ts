import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/server";

/** MVP platform-wide quota for expensive new quotes, not a per-user security identity. */
export async function checkPrepareBudget(scope: "launch_prepare" | "funding_prepare") {
  const { data, error } = await getAdminDb().rpc("consume_prepare_budget", { p_scope: scope });
  if (error) return NextResponse.json({ error: "Preparation safety checks are unavailable. No transaction prepared." }, { status: 503 });
  if (data !== true) return NextResponse.json({ error: "Preparation capacity reached. Wait one minute and retry. Existing receipt recovery remains available." }, { status: 429, headers: { "Retry-After": "60" } });
  return null;
}
