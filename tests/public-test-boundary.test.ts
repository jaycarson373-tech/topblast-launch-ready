import { afterEach, expect, it, vi } from "vitest";
import { canAccessTestLaunch } from "@/lib/test-launch-access";
import { isAdminRequest } from "@/lib/admin-auth";

afterEach(() => vi.unstubAllEnvs());
it("opening hidden tests never grants administrative access", () => {
  vi.stubEnv("ADMIN_API_TOKEN", "fixture-admin-token");
  vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", "true");
  const request = new Request("https://example.test");
  expect(canAccessTestLaunch(request)).toBe(true);
  expect(isAdminRequest(request)).toBe(false);
});
it.each(["", "false", "1", "TRUE"])("fails closed without an explicit enable value (%s)", (flag) => {
  vi.stubEnv("PUBLIC_TEST_LAUNCHES_ENABLED", flag);
  expect(canAccessTestLaunch(new Request("https://example.test"))).toBe(false);
});
