import { applyVenueLaunch, getBoundLaunchSubmission, recordLaunchSubmissionError } from "@/lib/db/launch-repository";
import { launchVenue } from "@/lib/venue/registry";
import { getAdminDb } from "@/lib/db/server";

export async function submitBoundLaunch(launchId: string) {
  const receipt = await getBoundLaunchSubmission(launchId);
  const { data: launch, error: launchError } = await getAdminDb().from("launches").select("image_url,venue").eq("id", launchId).single();
  if (launchError) throw launchError;
  try {
    const result = await launchVenue(launch.venue).submitLaunch({ signedQuote: receipt.signed_quote, signedTransaction: receipt.signed_payment_transaction, logo: launch.image_url });
    if (result.paymentSignature && result.paymentSignature !== receipt.payment_signature) throw new Error("Venue payment signature mismatch");
    result.paymentSignature = receipt.payment_signature;
    const trackerStatus = await applyVenueLaunch(launchId, result);
    return { launchId, trackerStatus, ...result };
  } catch (error) {
    await recordLaunchSubmissionError(launchId, error instanceof Error ? error.message : "Venue submission failed");
    throw error;
  }
}
