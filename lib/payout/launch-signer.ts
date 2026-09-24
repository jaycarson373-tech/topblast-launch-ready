import { createRailwaySigner } from "@/lib/payout/railway-signer";
import { resolveLaunchWallet, type LaunchWalletBinding } from "@/lib/payout/launch-wallet";

/** Worker-only selection. Never fall back to the platform key for a creator payout. */
export function createLaunchSigner(binding: LaunchWalletBinding, env: NodeJS.ProcessEnv = process.env) {
  const wallet = resolveLaunchWallet(binding, env);
  const secret = wallet.role === "topblast_creator" ? env.TOPBLAST_CREATOR_PRIVATE_KEY : env.TREASURY_PRIVATE_KEY;
  const variable = wallet.role === "topblast_creator" ? "TOPBLAST_CREATOR_PRIVATE_KEY" : "TREASURY_PRIVATE_KEY";
  if (!secret?.trim()) throw new Error(`${variable} is missing for the selected launch`);
  const signer = createRailwaySigner({ TREASURY_PRIVATE_KEY: secret });
  try {
    if (signer.publicKey() !== wallet.address) throw new Error("public address mismatch");
  } catch {
    throw new Error(`${variable} is invalid or does not match this launch's funding wallet`);
  }
  return signer;
}
