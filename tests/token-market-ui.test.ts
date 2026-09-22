// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const chart = vi.hoisted(() => ({ create: vi.fn(), data: vi.fn(), fit: vi.fn(), range: vi.fn(), remove: vi.fn() }));
vi.mock("lightweight-charts", () => ({ ColorType: { Solid: "solid" }, LineSeries: "line", createChart: chart.create }));
import { MarketOverview } from "@/components/market-overview";
import { PriceChart } from "@/components/price-chart";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  chart.create.mockReturnValue({ addSeries: () => ({ setData: chart.data }), timeScale: () => ({ fitContent: chart.fit, getVisibleRange: () => ({ from: 100, to: 200 }), setVisibleRange: chart.range }), applyOptions: vi.fn(), remove: chart.remove });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
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
  await act(async () => root.render(createElement(PriceChart, { points: [first, { ...first, price_quote_atoms_per_token: "200" }], decimals: 9 })));
  expect(chart.create).toHaveBeenCalledTimes(1);
  expect(chart.fit).toHaveBeenCalledTimes(1);
  expect(chart.data.mock.calls.at(-1)?.[0]).toHaveLength(1);
  expect(chart.range).toHaveBeenCalledWith({ from: 100, to: 200 });
});
