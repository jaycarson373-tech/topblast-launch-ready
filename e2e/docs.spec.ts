import { test, expect } from "@playwright/test";

test("docs explain real funding, Pump limits, and safe testing on every viewport", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url()); });
  await page.goto("/docs");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Docs", exact: true })).toBeVisible();
  await expect(page.getByText("Automatic creator-fee routing is not active.", { exact: false })).toBeVisible();
  await expect(page.getByText("PumpSwap graduation is not supported.", { exact: false })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Pump.fun" })).toContainText("Wrapped SOL (WSOL)");
  await page.getByRole("navigation", { name: "Documentation sections" }).getByRole("link", { name: "Read the proof" }).click();
  await expect(page).toHaveURL(/#proof$/);
  await expect(page.getByRole("heading", { name: "Allocated does not mean paid." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByRole("link", { name: "Run free simulation", exact: true }).click();
  await expect(page.getByText("SIMULATION ONLY · NOT DEVNET")).toBeVisible();
  expect(writes).toEqual([]);
});
