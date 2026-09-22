// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformProvider, LaunchActions, NavStatus } from "../components/platform-state";
let root: Root, host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(PlatformProvider, null, createElement(NavStatus), createElement(LaunchActions)))); }
it("resolves a stalled health check within twelve seconds without claiming availability", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  await render(); expect(host.textContent).toContain("CHECKING");
  await act(async () => vi.advanceTimersByTimeAsync(12_001));
  expect(host.textContent).toContain("CHECK FAILED"); expect(host.textContent).not.toContain("CHECKING");
  expect(host.querySelector('a[href="/test"]')).toBeNull();
  expect(host.querySelector('a[href="/launch"]')?.textContent).toBe("Launch token");
});
it("keeps pre-launch availability truthful without promoting a test mode", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ launchReady: false, rewardsReady: false, controlledTesting: true, venues: {}, checks: { dryRun: true } }, { status: 503 })));
  await render(); expect(host.textContent).toContain("PRE-LAUNCH");
  expect(host.textContent).not.toContain("AVAILABLE");
  expect(host.querySelector('a[href="/test"]')).toBeNull();
});
it("claims availability only after an affirmative health response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ launchReady: true, rewardsReady: false, venues: {}, checks: { dryRun: true } })));
  await render(); expect(host.textContent).toContain("AVAILABLE");
  expect(host.querySelector('a[href="/launch"]')?.textContent).toBe("Launch token");
});
