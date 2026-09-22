export function launchPageUsesTestMode() {
  return process.env.LAUNCHES_ENABLED !== "true" && (process.env.PUBLIC_TEST_LAUNCHES_ENABLED === "true" || Boolean(process.env.CONTROLLED_LAUNCH_WALLETS?.trim()));
}
