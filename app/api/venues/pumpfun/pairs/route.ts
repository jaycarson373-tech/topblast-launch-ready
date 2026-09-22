import { NextResponse } from "next/server";
import { PumpFunAdapter } from "@/lib/venue/pumpfun-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pairs = await new PumpFunAdapter().listPairs();
    return NextResponse.json({ pairs }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pump.fun pairs are unavailable" }, { status: 503 });
  }
}
