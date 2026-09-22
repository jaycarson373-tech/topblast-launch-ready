export function launchPageUsesTestMode() {
  return process.env.PUBLIC_TEST_LAUNCHES_ENABLED === "true" && process.env.LAUNCHES_ENABLED !== "true";
}
