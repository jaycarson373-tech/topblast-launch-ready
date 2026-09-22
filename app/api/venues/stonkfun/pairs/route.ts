import { NextResponse } from "next/server";
import { StonkFunAdapter } from "@/lib/venue/stonkfun-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pairs = await new StonkFunAdapter().listPairs();
    return NextResponse.json({ pairs }, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "StonkFun pairs are unavailable" }, { status: 503 });
  }
}
