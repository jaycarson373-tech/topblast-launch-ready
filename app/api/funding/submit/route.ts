import { NextResponse } from "next/server";
import { z } from "zod";
import { submitLaunchFunding } from "@/lib/funding/service";

export const runtime = "nodejs";
const schema = z.object({ intentId: z.string().uuid(), signedTransaction: z.string().min(100) });

export async function POST(request: Request) {
  try { const body = schema.parse(await request.json()); return NextResponse.json(await submitLaunchFunding(body.intentId, body.signedTransaction)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Funding submission failed" }, { status: 400 }); }
}
