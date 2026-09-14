import { NextResponse } from "next/server";
import { createLaunchDraft } from "@/lib/db/launch-repository";
import { StonkFunAdapter, StonkFunApiError } from "@/lib/venue/stonkfun-adapter";
import { launchDraftSchema, validateMinimumReward } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const draft = launchDraftSchema.parse(await request.json());
    validateMinimumReward(draft.allocation.topblastPercent);
    const expectedQuote = process.env.STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
    if (draft.quoteMint !== expectedQuote) return NextResponse.json({ error: "MVP launches must use the STONK pair" }, { status: 400 });
    const adapter = new StonkFunAdapter();
    const pair = await adapter.getPair(draft.quoteMint);
    if (!pair?.launchable || pair.launchLabReady === false) {
      return NextResponse.json({ error: "The STONK pair is not currently launchable on StonkFun" }, { status: 503 });
    }
    const prepared = await adapter.createLaunch(draft);
    if (!prepared.signedQuote || !prepared.paymentTransaction) throw new Error("StonkFun returned an incomplete launch quote");
    const launchId = await createLaunchDraft(draft, prepared.signedQuote);
    return NextResponse.json({ launchId, ...prepared });
  } catch (error) {
    if (error instanceof StonkFunApiError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Launch preparation failed" }, { status: 400 });
  }
}
