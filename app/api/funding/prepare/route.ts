import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareLaunchFunding } from "@/lib/funding/service";
import { checkPrepareBudget } from "@/lib/prepare-budget";

export const runtime = "nodejs";
const schema = z.object({ launchId: z.string().uuid(), funderWallet: z.string().min(32).max(64), amount: z.string().max(40) });

export async function POST(request: Request) {
  try { const body = schema.parse(await request.json()); const limited = await checkPrepareBudget("funding_prepare"); if (limited) return limited; return NextResponse.json(await prepareLaunchFunding(body.launchId, body.funderWallet, body.amount)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Funding preparation failed" }, { status: 400 }); }
}
