import { test, expect } from "@playwright/test";

test("venue colors remain labelled, change with selection, and retain launch safeguards", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/launch/test");
  const form = page.locator(".launch-form");
  await expect(form).toHaveClass(/venue-theme-stonkfun/);
  await expect(form.locator(".venue-badge")).toHaveText("StonkFun");
  await expect(form.locator(".venue-badge")).toHaveCSS("color", "rgb(36, 95, 203)");
  await page.getByLabel("Token name").fill("Retain my token");
  await page.getByLabel("Launch venue").selectOption("pumpfun");
  await expect(form).toHaveClass(/venue-theme-pumpfun/);
  await expect(form.locator(".venue-badge")).toHaveText("Pump.fun");
  await expect(form.locator(".venue-badge")).toHaveCSS("color", "rgb(18, 115, 77)");
  await expect(form.locator(".venue-button")).toHaveCSS("background-color", "rgb(18, 115, 77)");
  await expect(page.getByLabel("Token name")).toHaveValue("Retain my token");
  await expect(page.getByRole("button", { name: "Activation pending", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("homepage uses the refreshed logo and both labelled venue colors without mobile overflow", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".hero-venues .venue-badge")).toHaveText(["StonkFun", "Pump.fun"]);
  await expect(page.locator(".hero-mark")).toHaveAttribute("src", /topblast-venues/);
  await expect(page.locator(".hero-mark")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
