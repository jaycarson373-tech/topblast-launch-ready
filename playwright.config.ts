import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  use: { baseURL: process.env.TEST_URL ?? "http://127.0.0.1:3104", channel: "chrome", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: process.env.TEST_URL ? undefined : { command: "pnpm start --port 3104", url: "http://127.0.0.1:3104/test", reuseExistingServer: false, timeout: 60_000 },
});
