import { NextResponse } from "next/server";
import { createLaunchDraft } from "@/lib/db/launch-repository";
import { StonkFunApiError } from "@/lib/venue/stonkfun-adapter";
import { launchVenue } from "@/lib/venue/registry";
import { PUMP_SOL_MINT } from "@/lib/solana/pumpfun";
import { launchDraftSchema, validateMinimumReward } from "@/lib/validation";
import { assertLaunchReady } from "@/lib/readiness";
import { getTreasuryBalance, solanaRpc } from "@/lib/solana/rpc";
import { isAdminRequest } from "@/lib/admin-auth";
import { assertTestLaunchReady } from "@/lib/test-launch-readiness";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const draft = launchDraftSchema.parse(await request.json());
    if (draft.isTest) {
      if (!isAdminRequest(request)) return NextResponse.json({ error: "Operator authorization is required for test launches" }, { status: 401 });
      await assertTestLaunchReady();
      if (await solanaRpc<string>("getGenesisHash") !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("Controlled venue tests require Solana mainnet");
    } else assertLaunchReady();
    validateMinimumReward(draft.allocation.topblastPercent);
    if (!draft.isTest && draft.venue === "pumpfun" && process.env.PUMPFUN_ENABLED !== "true") throw new Error("Pump.fun acceptance is pending. Creation is not enabled yet.");
    if (draft.creatorWallet === process.env.TOPBLAST_TREASURY_ADDRESS) throw new Error("Use a separate creator wallet so this launch can fund rewards");
    const expectedQuote = draft.venue === "pumpfun" ? PUMP_SOL_MINT : process.env.STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
    if (draft.quoteMint !== expectedQuote) return NextResponse.json({ error: "Unsupported quote mint for the selected venue" }, { status: 400 });
    draft.quoteSymbol = draft.venue === "pumpfun" ? "SOL" : "STONK";
    await getTreasuryBalance(process.env.TOPBLAST_TREASURY_ADDRESS!);
    const adapter = launchVenue(draft.venue);
    const pair = await adapter.getPair(draft.quoteMint);
    if (!pair?.launchable || pair.launchLabReady === false) {
      return NextResponse.json({ error: "The selected pair is not currently launchable on this venue" }, { status: 503 });
    }
    const prepared = await adapter.createLaunch(draft);
    if (!prepared.signedQuote || !prepared.paymentTransaction) throw new Error("The venue returned an incomplete launch quote");
    if (draft.isTest && draft.venue === "stonkfun") {
      const simulation = await solanaRpc<{ value: { err: unknown } }>("simulateTransaction", [prepared.paymentTransaction, {
        encoding: "base64", commitment: "finalized", sigVerify: false, replaceRecentBlockhash: false,
      }]);
      if (simulation.value.err) throw new Error(`StonkFun test payment simulation failed: ${JSON.stringify(simulation.value.err)}`);
      prepared.raw = { ...prepared.raw, simulation: "passed" };
    }
    const launchId = await createLaunchDraft(draft, prepared.signedQuote, prepared.paymentTransaction, prepared.expiresAt);
    return NextResponse.json({ launchId, ...prepared });
  } catch (error) {
    if (error instanceof StonkFunApiError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Launch preparation failed" }, { status: 400 });
  }
}
