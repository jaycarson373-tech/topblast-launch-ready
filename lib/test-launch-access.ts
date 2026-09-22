import { isAdminRequest } from "@/lib/admin-auth";

// Opens hidden, creator-funded test launches only. Never grants admin or payout access.
export function canAccessTestLaunch(request: Request): boolean {
  return process.env.PUBLIC_TEST_LAUNCHES_ENABLED === "true" || isAdminRequest(request);
}
