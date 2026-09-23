// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@solana/web3.js", () => ({ Keypair: { generate: vi.fn() }, Transaction: {} }));
vi.mock("@wallet-standard/app", () => ({ getWallets: () => ({ get: () => [], on: () => () => undefined }) }));
import { LaunchForm } from "@/components/launch-form";

const key = "topblast-launch-receipt-v1";
const receipt = { launchId: "59879954-cf27-42c7-9166-951b999dd2e2", paymentSignature: "saved-public-signature" };
const failed = { status: "failed", retrySafe: true, failureMessage: "Expired without landing. You can prepare a new review." };
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
const button = (text: string) => [...container.querySelectorAll("button")].find(node => node.textContent?.includes(text))!;
const fields = () => container.querySelector("fieldset")!;
const health = () => Response.json({ venues: { stonkfun: { launchReady: true, blockers: [] }, pumpfun: { launchReady: true, blockers: [] } } });
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); localStorage.setItem(key, JSON.stringify(receipt));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  fetchMock = vi.fn(async (url: string) => url === "/api/health" ? health() : Response.json(failed));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals();
});
const render = async () => { await act(async () => { root.render(createElement(LaunchForm)); }); };

describe("saved receipt recovery clicks, isolated DOM with no browser or wallet", () => {
  it("automatically checks a restored receipt and puts a usable recovery control BEFORE the locked fields", async () => {
    await render();
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/api/launch/status/"))).toHaveLength(1);
    const fresh = button("Save receipt and start a fresh review");
    expect(fresh).toBeDefined(); expect(fresh.disabled).toBe(false);
    expect(fresh.closest("fieldset")).toBeNull();
    expect(fresh.compareDocumentPosition(fields()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fields().disabled).toBe(true);
    await act(async () => fresh.click());
    expect(fields().disabled).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    expect(JSON.parse(localStorage.getItem(`${key}-archive-${receipt.launchId}`)!)).toEqual(receipt);
    expect(fetchMock.mock.calls.every(([url]) => !url.includes("/submit") && !url.includes("/prepare"))).toBe(true);
  });
  it("a hanging status request times out and leaves check-status usable without unlocking another payment", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/health" ? health() : new Promise(() => {}));
    await render();
    expect(button("Verifying launch receipt").disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(button("Refresh launch receipt").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("timed out");
    expect(fields().disabled).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(button("Save receipt")).toBeUndefined();
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    fetchMock.mockResolvedValue(Response.json(failed));
    await act(async () => button("Refresh launch receipt").click());
    expect(button("Save receipt and start a fresh review").disabled).toBe(false);
  });
  it("never enables a fresh review for an uncertain or still processing transaction", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/health" ? health() : Response.json({ status: "processing" }));
    await render();
    expect(fields().disabled).toBe(true);
    expect(button("Refresh launch receipt").disabled).toBe(false);
    expect(button("Save receipt")).toBeUndefined();
    expect(localStorage.getItem(key)).not.toBeNull();
  });
  it("keeps the receipt and shows an actionable error if archival storage fails", async () => {
    await render();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await act(async () => button("Save receipt and start a fresh review").click());
    expect(fields().disabled).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    write.mockRestore();
  });
  it("shows a launched confirmation and direct TopBlast token link after completion", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/health" ? health() : Response.json({ status: "completed", mint: "mint-live", pool: "market-live", signature: "launch-signature", trackerStatus: "active" }));
    await render();
    expect(container.textContent).toContain("LAUNCHED");
    expect(container.textContent).toContain("Your TopBlast page is live.");
    expect(container.querySelector('a[href="/token/mint-live"]')?.textContent).toBe("View token on TopBlast");
    expect(button("Refresh launch receipt")).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
