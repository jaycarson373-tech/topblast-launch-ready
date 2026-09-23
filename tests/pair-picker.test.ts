// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairPicker, type PairOption } from "@/components/pair-picker";

const pairs: PairOption[] = [
  { mint: "StonkMint111111111111111111111111111111111", symbol: "STONK", name: "Stonk", decimals: 6, launchable: true },
  { mint: "XSolMint1111111111111111111111111111111111", symbol: "xSOL", name: "Leveraged SOL", decimals: 9, launchable: true },
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, launchable: true },
  { mint: "OtherMint11111111111111111111111111111111", symbol: "ABC", name: "Another Coin", decimals: 6, launchable: true },
];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("venue pair picker", () => {
  it("shows SOL as the selected default and groups popular pairs first", async () => {
    await act(async () => root.render(createElement(PairPicker, { id: "pair", label: "Quote pair", venue: "stonkfun", pairs, value: pairs[2].mint, onChange: vi.fn() })));
    expect(container.querySelector(".pair-picker-trigger")?.textContent).toContain("SOL");
    await act(async () => (container.querySelector(".pair-picker-trigger") as HTMLButtonElement).click());
    expect(container.querySelector(".pair-picker-group-title")?.textContent).toBe("Popular");
    expect(container.querySelector(".pair-picker-option strong")?.textContent).toBe("SOL");
  });

  it("searches by name, ticker, or mint and selects the result", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(createElement(PairPicker, { id: "pair", label: "Quote pair", venue: "pumpfun", pairs, value: pairs[2].mint, onChange })));
    await act(async () => (container.querySelector(".pair-picker-trigger") as HTMLButtonElement).click());
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "leveraged");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const options = [...container.querySelectorAll(".pair-picker-option")];
    expect(options).toHaveLength(1); expect(options[0].textContent).toContain("xSOL");
    await act(async () => (options[0] as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith(pairs[1].mint);
  });
});
