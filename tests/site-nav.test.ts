// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SiteNav } from "../components/site-nav";

let root: Root;
let container: HTMLDivElement;
const writeText = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (featuredMint?: string) => {
  await act(async () => root.render(createElement(SiteNav, { featuredMint, xUrl: "https://x.com/Topblast_pad" })));
};
it("shows an empty bordered address control without inventing a mint or copying an empty value", async () => {
  await render();
  const button = container.querySelector<HTMLButtonElement>(".ca-button")!;
  expect(button.textContent).toBe("CA:");
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(writeText).not.toHaveBeenCalled();
  expect(container.querySelector('a[aria-label="TopBlast Launch on X"]')?.getAttribute("href")).toBe("https://x.com/Topblast_pad");
  expect(container.querySelector('a[href^="/token/"]')).toBeNull();
});
it("copies the complete configured address, not its abbreviated display", async () => {
  const mint = "7vt4NxCCBRtyj4kkpiKNZRnHbgJkAww4qsDn4DxKeaM";
  await render(mint);
  const button = container.querySelector<HTMLButtonElement>(".ca-button")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(writeText).toHaveBeenCalledWith(mint);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("CA copied");
});
it("announces clipboard failure without claiming it copied", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  await render("7vt4NxCCBRtyj4kkpiKNZRnHbgJkAww4qsDn4DxKeaM");
  await act(async () => container.querySelector<HTMLButtonElement>(".ca-button")!.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Copy unavailable");
});
