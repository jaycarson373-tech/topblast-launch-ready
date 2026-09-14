import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { preparePayoutBatch, reconcilePayoutBatch, submitPayoutBatch } from "@/lib/payout/service";

export const runtime = "nodejs";
function authorized(request: Request) {
  const expected = process.env.ADMIN_API_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && Buffer.byteLength(expected) === Buffer.byteLength(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)));
}
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), batchId: z.string().uuid() }),
  z.object({ action: z.literal("submit"), batchId: z.string().uuid(), signedTransaction: z.string().min(100) }),
  z.object({ action: z.literal("reconcile"), batchId: z.string().uuid() }),
]);
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = schema.parse(await request.json());
    if (body.action === "prepare") return NextResponse.json(await preparePayoutBatch(body.batchId));
    if (body.action === "submit") return NextResponse.json(await submitPayoutBatch(body.batchId, body.signedTransaction));
    return NextResponse.json(await reconcilePayoutBatch(body.batchId));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Payout operation failed" }, { status: 400 }); }
}
