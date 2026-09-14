import { NextResponse } from "next/server";
import { applyVenueLaunch, verifyLaunchQuote } from "@/lib/db/launch-repository";
import { StonkFunAdapter, StonkFunApiError } from "@/lib/venue/stonkfun-adapter";
import { submitLaunchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = submitLaunchSchema.parse(await request.json());
    await verifyLaunchQuote(input.launchId, input.signedQuote);
    const result = await new StonkFunAdapter().submitLaunch(input);
    await applyVenueLaunch(input.launchId, result);
    return NextResponse.json({ launchId: input.launchId, ...result });
  } catch (error) {
    if (error instanceof StonkFunApiError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable, charged: error.details.charged }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Launch submission failed" }, { status: 400 });
  }
}
