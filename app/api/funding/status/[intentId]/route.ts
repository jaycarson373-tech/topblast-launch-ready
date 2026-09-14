import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcileLaunchFunding } from "@/lib/funding/service";

export const runtime = "nodejs";
export async function GET(_: Request, context: { params: Promise<{ intentId: string }> }) {
  try { const { intentId } = await context.params; return NextResponse.json(await reconcileLaunchFunding(z.string().uuid().parse(intentId))); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Funding recovery failed" }, { status: 400 }); }
}
