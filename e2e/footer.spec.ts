import { test, expect } from "@playwright/test";

test("footer appears after page content with safe destinations and no mobile overflow", async ({ page }) => {
  await page.goto("/docs");
  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeVisible();
  const dex = footer.getByRole("link", { name: "Dexscreener" });
  const stonk = footer.getByRole("link", { name: "StonkFun" });
  await expect(dex).toHaveAttribute("href", /^https:\/\/(www\.)?dexscreener\.com\//);
  await expect(stonk).toHaveAttribute("href", /^https:\/\/(www\.)?stonkfun\.xyz/);
  for (const link of [dex, stonk]) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(footer.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "/docs");
  await dex.focus();
  await expect(dex).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(stonk).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await footer.evaluate((element) => !element.nextElementSibling || ["SCRIPT", "NEXT-ROUTE-ANNOUNCER"].includes(element.nextElementSibling.tagName))).toBe(true);
});
