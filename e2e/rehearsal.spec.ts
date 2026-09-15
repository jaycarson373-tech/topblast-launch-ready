import { test, expect } from "@playwright/test";

test("rehearsal completes, recovers a partial result, and never submits money", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url()); });
  await page.goto("/test");
  await expect(page.getByText("SIMULATION ONLY · NOT DEVNET")).toBeVisible();
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Run next step", exact: true }).click();
  await expect(page.getByText("SAMPLE PAYOUT INTERRUPTED", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved rehearsal restored.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Run next step", exact: true }).click();
  await expect(page.getByText("REHEARSAL COMPLETE", { exact: true })).toBeVisible();
  await expect(page.getByText("2 unique simulated payment key(s).", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Replay recovery check" }).click();
  await expect(page.getByText("Local recovery ran 2 time(s). 2 unique simulated payment key(s).", { exact: false })).toBeVisible();
  await expect(page.getByText("Its allocations remain 0.00 STONK", { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("rehearsal.png"), fullPage: true });
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("selling and zero funding visibly prevent sample rewards", async ({ page }) => {
  await page.goto("/test");
  await page.getByLabel("Holder A activity this epoch").selectOption("sell");
  await page.getByRole("button", { name: "Run full rehearsal" }).click();
  const holder = page.getByRole("row").filter({ hasText: "Holder A" });
  await expect(holder).toContainText("SOLD THIS EPOCH");
  await expect(holder).toContainText("0.00 STONK");
  await page.getByLabel("Sample gross revenue:").fill("0");
  await page.getByRole("button", { name: "Run full rehearsal" }).click();
  await expect(page.getByText("0 unique simulated payment key(s).", { exact: false })).toBeVisible();
});

test("production status failure is distinct from a working simulation", async ({ page }) => {
  await page.route("**/api/health", (route) => route.abort());
  await page.goto("/test");
  await expect(page.getByRole("alert").filter({ hasText: "Live status could not be checked" })).toBeVisible();
  await page.getByRole("button", { name: "Run full rehearsal" }).click();
  await expect(page.getByText("REHEARSAL COMPLETE", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open real launch form" }).click();
  await expect(page.getByRole("button", { name: "Activation pending", exact: true })).toBeDisabled();
  await expect(page.getByRole("option", { name: "Pump.fun · SOL pair" })).toHaveCount(0);
});
