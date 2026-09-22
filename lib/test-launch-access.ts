import { isAdminRequest } from "@/lib/admin-auth";

// Opens hidden, creator-funded test launches only. Never grants admin or payout access.
export function controlledLaunchWallets(): string[] {
  return (process.env.CONTROLLED_LAUNCH_WALLETS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}
export function canAccessTestLaunch(request: Request, creatorWallet?: string): boolean {
  // Public release closes the test path, even for admins or stale test flags.
  if (process.env.LAUNCHES_ENABLED === "true") return false;
  // The address authorizes quote preparation only. Submission separately verifies
  // the creator's signature over the exact stored transaction before broadcasting.
  return process.env.PUBLIC_TEST_LAUNCHES_ENABLED === "true" || isAdminRequest(request) || Boolean(creatorWallet && controlledLaunchWallets().includes(creatorWallet));
}
