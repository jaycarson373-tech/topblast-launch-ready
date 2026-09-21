import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { assertTestLaunchReady } from "@/lib/test-launch-readiness";
import { GET as getHealth } from "@/app/api/health/route";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Operator authorization required" }, { status: 401 });
  try {
    await assertTestLaunchReady();
    const health = await (await getHealth()).json();
    const infrastructure = health.checks.databaseReachable && health.checks.workerFresh && health.checks.treasuryRpcReachable;
    return NextResponse.json({
      ready: Boolean(infrastructure && health.checks.pumpSchemaReady && health.checks.stonkPairReady && health.checks.stonkCreationReady),
      stonkBlockers: [!infrastructure && "Infrastructure checks incomplete", !health.checks.pumpSchemaReady && "Launch metadata migration required",
        !health.checks.stonkPairReady && "STONK pair unavailable", !health.checks.stonkCreationReady && (health.checks.stonkCreationError || "Stonk creation unavailable")].filter(Boolean),
      pumpReady: Boolean(infrastructure && health.checks.pumpSchemaReady && health.checks.pumpPairReady),
      missing: health.missing,
      pumpBlockers: infrastructure && health.checks.pumpSchemaReady && health.checks.pumpPairReady ? [] : ["Pump or infrastructure checks incomplete"],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Test readiness unavailable" }, { status: 503 });
  }
}
