// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const chart = vi.hoisted(() => ({ create: vi.fn(), data: vi.fn(), fit: vi.fn(), range: vi.fn(), remove: vi.fn() }));
vi.mock("lightweight-charts", () => ({ ColorType: { Solid: "solid" }, LineSeries: "line", createChart: chart.create }));
import { MarketOverview } from "@/components/market-overview";
import { PriceChart } from "@/components/price-chart";
import { TokenPage } from "@/components/token-page";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  chart.create.mockReturnValue({ addSeries: () => ({ setData: chart.data }), timeScale: () => ({ fitContent: chart.fit, getVisibleRange: () => ({ from: 100, to: 200 }), setVisibleRange: chart.range }), applyOptions: vi.fn(), remove: chart.remove });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(node => node.textContent === text)!;
it("shows real amounts, filters trades and provides honest venue-directed buy/sell actions", async () => {
  await act(async () => root.render(createElement(MarketOverview, {
    address: "mint", launch: { venue: "stonkfun", symbol: "WTF", quote_symbol: "STONK", market_address: "pool", created_at: "2026-09-22T00:00:00Z" },
    market: { history_complete: false, quote_decimals: 9, base_decimals: 6 }, prices: [],
    spot: { status: "available", priceAtoms: "10307", observedAt: "2026-09-22T12:00:00Z" },
    trades: [{ id: "buy", signature: "receipt", wallet: "buyer", kind: "verified_buy", token_raw: "1000000", quote_atoms: "123", slot: 123, block_time: null }], tradesAvailable: true,
  })));
  expect(host.textContent).toContain("0.000010307 STONK");
  expect(host.querySelector('a[href="https://www.stonkfun.xyz/token/mint"]')?.textContent).toContain("Buy on StonkFun");
  expect(host.textContent).toContain("WTF / STONK");
  expect(host.textContent).not.toContain("Market account");
  expect(host.querySelector('a[href="https://solscan.io/tx/receipt"]')).not.toBeNull();
  expect(host.textContent).toContain("reward eligibility remains gated");
  await act(async () => button("Sell").click());
  expect(host.textContent).toContain("Sell on StonkFun");
  expect(host.textContent).toContain("Trading is completed at the venue, not inside TopBlast");
  await act(async () => button("Sells").click());
  expect(host.querySelector('a[href="https://solscan.io/tx/receipt"]')).toBeNull();
  await act(async () => button("Buys").click());
  expect(host.querySelector('a[href="https://solscan.io/tx/receipt"]')).not.toBeNull();
});
it("updates data without recreating the chart or resetting the user's viewport", async () => {
  const first = { block_time: "2026-09-22T12:00:00Z", price_quote_atoms_per_token: "100" };
  await act(async () => root.render(createElement(PriceChart, { points: [first], decimals: 9 })));
  await act(async () => host.querySelector(".chart-host")!.dispatchEvent(new WheelEvent("wheel", { bubbles: true })));
  await act(async () => root.render(createElement(PriceChart, { points: [first, { ...first, price_quote_atoms_per_token: "200" }], decimals: 9 })));
  expect(chart.create).toHaveBeenCalledTimes(1);
  expect(chart.fit).toHaveBeenCalledTimes(1);
  expect(chart.data.mock.calls.at(-1)?.[0]).toHaveLength(1);
  expect(chart.range).toHaveBeenCalledWith({ from: 100, to: 200 });
});
it("keeps new points visible in ALL until the user pans or zooms", async () => {
  const first = { block_time: "2026-09-22T12:00:00Z", price_quote_atoms_per_token: "100" };
  await act(async () => root.render(createElement(PriceChart, { points: [first], decimals: 9 })));
  await act(async () => root.render(createElement(PriceChart, { points: [first, { ...first, block_time: "2026-09-22T12:05:00Z" }], decimals: 9 })));
  expect(chart.create).toHaveBeenCalledTimes(1);
  expect(chart.fit).toHaveBeenCalledTimes(2);
});
const payload = (priceAtoms = "1000000") => ({
  launch: { name: "ALPHA", symbol: "A", venue: "stonkfun", quote_symbol: "STONK", tracker_status: "active", created_at: "2026-09-22T00:00:00Z" },
  market: { history_complete: true, quote_decimals: 9, base_decimals: 6 }, funding: null, prices: [], trades: [],
  epochs: [], allocations: [], deposits: [], totalRewardedAtoms: "0", enginePaused: true,
  marketData: { status: "available", priceAtoms, observedAt: "2026-09-22T12:00:00Z" },
});
it("automatically refreshes real data every 15 seconds", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json(payload())); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(createElement(TokenPage, { address: "mint-a" })));
  expect(host.textContent).toContain("0.001 STONK");
  fetcher.mockImplementation(async () => Response.json(payload("2000000")));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("0.002 STONK");
});
it("never displays token A data under token B while the new request is pending", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("mint-a") ? Response.json(payload()) : new Promise(() => {})));
  await act(async () => root.render(createElement(TokenPage, { address: "mint-a" })));
  expect(host.textContent).toContain("ALPHA");
  await act(async () => root.render(createElement(TokenPage, { address: "mint-b" })));
  expect(host.textContent).not.toContain("ALPHA");
  expect(host.textContent).toContain("Loading verified launch data");
});
