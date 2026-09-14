import { NextResponse } from "next/server";
import { applyVenueLaunch, verifyLaunchPayment } from "@/lib/db/launch-repository";
import { StonkFunAdapter, StonkFunApiError } from "@/lib/venue/stonkfun-adapter";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ signature: string }> }) {
  try {
    const { signature } = await context.params;
    const launchId = new URL(request.url).searchParams.get("launchId");
    if (!launchId) return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    await verifyLaunchPayment(launchId, signature);
    const result = await new StonkFunAdapter().getLaunch(signature);
    await applyVenueLaunch(launchId, result);
    return NextResponse.json({ launchId, ...result });
  } catch (error) {
    if (error instanceof StonkFunApiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status lookup failed" }, { status: 400 });
  }
}
