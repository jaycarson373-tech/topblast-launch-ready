// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@wallet-standard/app", () => ({ getWallets: () => ({ get: () => [], on: () => () => undefined }) }));
import { LaunchForm } from "@/components/launch-form";

it("offers an optional dev-buy input for both venues without connecting or submitting", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ venues: { stonkfun: { launchReady: true }, pumpfun: { launchReady: true } }, pairs: [{ mint: "So11111111111111111111111111111111111111112", name: "Solana", symbol: "SOL", decimals: 9, launchable: true }] }));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div"), root = createRoot(container);
  document.body.appendChild(container);
  try {
    await act(async () => root.render(createElement(LaunchForm)));
    const field = () => container.querySelector<HTMLInputElement>('[name="devBuyAmount"]')!;
    expect(field().required).toBe(false);
    expect(field().value).toBe("");
    expect(container.querySelector('label[for="devBuyAmount"]')?.textContent).toContain("Dev buy (optional)");
    const select = container.querySelector<HTMLSelectElement>("#venue")!;
    await act(async () => { select.value = "pumpfun"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(field()).not.toBeNull();
    expect(container.querySelector("#dev-buy-help")?.textContent).toContain("Tokens go directly to your connected creator wallet");
    expect(fetchMock.mock.calls.every(args => !String(args[0]).includes("/prepare") && !String(args[0]).includes("/submit"))).toBe(true);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
