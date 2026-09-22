import { NextResponse } from "next/server";
import { verifyLaunchQuote, bindLaunchPayment } from "@/lib/db/launch-repository";
import { StonkFunApiError } from "@/lib/venue/stonkfun-adapter";
import { submitBoundLaunch } from "@/lib/venue/launch-submission-service";
import { submitLaunchSchema } from "@/lib/validation";

import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import { inspectSignedMessage } from "@/lib/solana/signed-message";
import { canAccessTestLaunch } from "@/lib/test-launch-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = submitLaunchSchema.parse(await request.json());
    const prepared = await verifyLaunchQuote(input.launchId, input.signedQuote);
    if (prepared.isTest && !canAccessTestLaunch(request, prepared.creatorWallet)) return NextResponse.json({ error: "Controlled testing is currently closed for this creator. Keep your receipt and do not pay again." }, { status: 403 });
    inspectSignedMessage({ signedTransaction: input.signedTransaction, expectedMessageHash: prepared.paymentMessageHash, expectedPayer: prepared.creatorWallet });
    const paymentSignature = paymentSignatureFromTransaction(Buffer.from(input.signedTransaction, "base64"));
    await bindLaunchPayment(input.launchId, paymentSignature, input.signedTransaction);
    return NextResponse.json(await submitBoundLaunch(input.launchId));
  } catch (error) {
    if (error instanceof StonkFunApiError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable, charged: error.details.charged }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Launch submission failed" }, { status: 400 });
  }
}
