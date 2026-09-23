"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PairOption {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  launchable: boolean;
  launchLabReady?: boolean;
}

const FEATURED = ["SOL", "STONK", "XSOL", "USDC", "USDT", "PUMP"];

const shortMint = (mint: string) => `${mint.slice(0, 5)}…${mint.slice(-5)}`;

function pairOrder(left: PairOption, right: PairOption) {
  const leftPriority = FEATURED.indexOf(left.symbol.toUpperCase());
  const rightPriority = FEATURED.indexOf(right.symbol.toUpperCase());
  if (leftPriority !== -1 || rightPriority !== -1) {
    if (leftPriority === -1) return 1;
    if (rightPriority === -1) return -1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  }
  return left.symbol.localeCompare(right.symbol) || left.name.localeCompare(right.name);
}

export function PairPicker({
  id,
  label,
  venue,
  pairs,
  value,
  onChange,
}: {
  id: string;
  label: string;
  venue: "stonkfun" | "pumpfun";
  pairs: PairOption[];
  value: string;
  onChange: (mint: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const normalized = useMemo(() => {
    const unique = new Map<string, PairOption>();
    for (const pair of pairs) if (!unique.has(pair.mint)) unique.set(pair.mint, pair);
    return [...unique.values()].sort(pairOrder);
  }, [pairs]);
  const selected = normalized.find((pair) => pair.mint === value) ?? normalized[0];
  const popular = normalized.filter((pair) => FEATURED.includes(pair.symbol.toUpperCase())).slice(0, 6);
  const popularMints = new Set(popular.map((pair) => pair.mint));
  const search = query.trim().toLowerCase();
  const matches = normalized.filter((pair) => !search || `${pair.symbol} ${pair.name} ${pair.mint}`.toLowerCase().includes(search));
  const remaining = search ? matches : normalized.filter((pair) => !popularMints.has(pair.mint));
  const visible = remaining.slice(0, 100);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function choose(pair: PairOption) {
    onChange(pair.mint);
    setOpen(false);
    setQuery("");
  }

  const option = (pair: PairOption) => (
    <button
      type="button"
      className="pair-picker-option"
      role="option"
      aria-selected={pair.mint === value}
      key={pair.mint}
      onClick={() => choose(pair)}
    >
      <span className="pair-picker-token">{pair.symbol.slice(0, 5)}</span>
      <span><strong>{pair.symbol}</strong><small>{pair.name}</small></span>
      <span className="pair-picker-address">{shortMint(pair.mint)}</span>
    </button>
  );

  return (
    <div className="pair-picker" ref={root}>
      <label id={`${id}-label`}>{label}</label>
      <button
        id={id}
        type="button"
        className="pair-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pair-picker-token">{selected?.symbol.slice(0, 5) ?? "?"}</span>
        <span className="pair-picker-selected">
          <strong>{selected?.symbol ?? "Choose pair"}</strong>
          <small>{selected?.name ?? "Search available pairs"}</small>
        </span>
        <span className="pair-picker-selected-mint">{selected ? shortMint(selected.mint) : ""}</span>
        <span aria-hidden="true" className="pair-picker-chevron">⌄</span>
      </button>
      {open && (
        <div className="pair-picker-menu">
          <div className="pair-picker-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
              placeholder="Search ticker, name, or address"
              aria-label={`Search ${venue === "stonkfun" ? "StonkFun" : "Pump.fun"} pairs`}
            />
          </div>
          <div className="pair-picker-results" role="listbox" aria-labelledby={`${id}-label`}>
            {!search && popular.length > 0 && <section className="pair-picker-group"><div className="pair-picker-group-title">Popular</div>{popular.map(option)}</section>}
            <section className="pair-picker-group">
              <div className="pair-picker-group-title">{search ? `${matches.length} result${matches.length === 1 ? "" : "s"}` : "All pairs"}</div>
              {visible.map(option)}
              {!visible.length && <p className="pair-picker-empty">No supported pair matches that search.</p>}
              {remaining.length > visible.length && <p className="pair-picker-limit">Showing the first 100. Search by ticker, name, or mint address to narrow it down.</p>}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
