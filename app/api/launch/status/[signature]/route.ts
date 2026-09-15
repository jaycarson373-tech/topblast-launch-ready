import { NextResponse } from "next/server";
import { applyVenueLaunch, verifyLaunchPayment } from "@/lib/db/launch-repository";
import { StonkFunApiError } from "@/lib/venue/stonkfun-adapter";
import { launchVenue } from "@/lib/venue/registry";
import { getAdminDb } from "@/lib/db/server";
import { submitBoundLaunch } from "@/lib/venue/launch-submission-service";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ signature: string }> }) {
  try {
    const { signature } = await context.params;
    const launchId = new URL(request.url).searchParams.get("launchId");
    if (!launchId) return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    await verifyLaunchPayment(launchId, signature);
    const { data: launch, error: launchError } = await getAdminDb().from("launches").select("venue").eq("id", launchId).single();
    if (launchError) throw launchError;
    let result;
    try { result = await launchVenue(launch.venue).getLaunch(signature); }
    catch (error) {
      if (!(error instanceof StonkFunApiError) || error.status !== 404) throw error;
      return NextResponse.json(await submitBoundLaunch(launchId));
    }
    if (result.paymentSignature && result.paymentSignature !== signature) throw new Error("Venue payment signature mismatch");
    result.paymentSignature = signature;
    const trackerStatus = await applyVenueLaunch(launchId, result);
    return NextResponse.json({ launchId, trackerStatus, ...result });
  } catch (error) {
    if (error instanceof StonkFunApiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status lookup failed" }, { status: 400 });
  }
}
