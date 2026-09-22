import { NextResponse } from "next/server";
import { createLaunchDraft } from "@/lib/db/launch-repository";
import { StonkFunApiError } from "@/lib/venue/stonkfun-adapter";
import { launchVenue } from "@/lib/venue/registry";
import { launchDraftSchema, validateMinimumReward } from "@/lib/validation";
import { assertLaunchReady } from "@/lib/readiness";
import { getTreasuryBalance, solanaRpc } from "@/lib/solana/rpc";
import { canAccessTestLaunch } from "@/lib/test-launch-access";
import { assertTestLaunchReady } from "@/lib/test-launch-readiness";
import { checkPrepareBudget } from "@/lib/prepare-budget";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const draft = launchDraftSchema.parse(await request.json());
    if (draft.isTest) {
      if (!canAccessTestLaunch(request, draft.creatorWallet)) return NextResponse.json({ error: "Controlled testing requires an approved creator wallet. Public launches remain closed." }, { status: 403 });
      await assertTestLaunchReady();
      if (await solanaRpc<string>("getGenesisHash") !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("Controlled venue tests require Solana mainnet");
    } else assertLaunchReady();
    const rateLimit = await checkPrepareBudget("launch_prepare");
    if (rateLimit) return rateLimit;
    validateMinimumReward(draft.allocation.topblastPercent);
    if (!process.env.TOPBLAST_TREASURY_ADDRESS) throw new Error("TopBlast fee treasury is not configured");
    if (!draft.isTest && draft.venue === "pumpfun" && process.env.PUMPFUN_ENABLED !== "true") throw new Error("Pump.fun acceptance is pending. Creation is not enabled yet.");
    if (draft.creatorWallet === process.env.TOPBLAST_TREASURY_ADDRESS) throw new Error("Use a separate creator wallet so this launch can fund rewards");
    await getTreasuryBalance(process.env.TOPBLAST_TREASURY_ADDRESS!);
    const adapter = launchVenue(draft.venue);
    const pair = await adapter.getPair(draft.quoteMint);
    if (!pair?.launchable || pair.launchLabReady === false) {
      return NextResponse.json({ error: "The selected pair is not currently launchable on this venue" }, { status: 503 });
    }
    // Never trust a browser-supplied symbol. Bind the stored/reviewed symbol to
    // the exact venue-verified quote mint selected for this launch.
    draft.quoteSymbol = pair.symbol;
    const prepared = await adapter.createLaunch(draft);
    if (!prepared.signedQuote || !prepared.paymentTransaction) throw new Error("The venue returned an incomplete launch quote");
    if (draft.isTest && draft.venue === "stonkfun") {
      const simulation = await solanaRpc<{ value: { err: unknown } }>("simulateTransaction", [prepared.paymentTransaction, {
        encoding: "base64", commitment: "finalized", sigVerify: false, replaceRecentBlockhash: false,
      }]);
      if (simulation.value?.err !== null) throw new Error(`StonkFun test payment simulation failed or returned no verified result: ${JSON.stringify(simulation.value?.err)}`);
      prepared.raw = { ...prepared.raw, simulation: "passed" };
    }
    const launchId = await createLaunchDraft(draft, prepared.signedQuote, prepared.paymentTransaction, prepared.expiresAt);
    return NextResponse.json({ launchId, ...prepared, rewardTreasury: process.env.TOPBLAST_TREASURY_ADDRESS, protocolTreasury: process.env.PROTOCOL_TREASURY_ADDRESS });
  } catch (error) {
    if (error instanceof StonkFunApiError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Launch preparation failed" }, { status: 400 });
  }
}
