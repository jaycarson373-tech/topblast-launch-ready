"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, createChart, createSeriesMarkers, LineSeries, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { chartPoints } from "@/lib/chart-points";
import type { PublicTrade } from "@/lib/token-trades";

export function PriceChart({ points, trades = [], decimals, baseSymbol = "TOKEN", quoteSymbol = "STONK" }: { baseSymbol?: string; quoteSymbol?: string; points: Array<{ block_time: string; price_quote_atoms_per_token: string }>; trades?: PublicTrade[]; decimals: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const initialized = useRef(false);
  const userMoved = useRef(false);
  const rangeRef = useRef("ALL");
  const normalized = useMemo(() => chartPoints(points, decimals), [points, decimals]);
  const markers = useMemo(() => {
    if (!normalized.length) return [] as SeriesMarker<Time>[];
    return trades.flatMap((trade): SeriesMarker<Time>[] => {
      const tradeTime = trade.block_time ? Math.floor(Date.parse(trade.block_time) / 1000) : NaN;
      if (!Number.isFinite(tradeTime)) return [];
      const nearest = normalized.reduce((best, point) => Math.abs(point.time - tradeTime) < Math.abs(best.time - tradeTime) ? point : best);
      const amount = trade.quote_atoms == null ? null : Number(trade.quote_atoms) / 10 ** decimals;
      const label = amount != null && Number.isFinite(amount) ? new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(amount) : "trade";
      const buy = trade.kind === "verified_buy";
      return [{ id: trade.id, time: nearest.time as UTCTimestamp, position: buy ? "belowBar" : "aboveBar", shape: buy ? "arrowUp" : "arrowDown", color: buy ? "#0ea66b" : "#d83220", text: `${buy ? "Topblasted" : "Sold"} ${label} ${quoteSymbol}`, size: 1 }];
    }).sort((a, b) => Number(a.time) - Number(b.time)).slice(-40);
  }, [trades, normalized, decimals, quoteSymbol]);
  const hasPoints = normalized.length > 0;
  const [range, setRange] = useState("ALL");
  useEffect(() => {
    if (!host.current || !hasPoints) return;
    const chart = createChart(host.current, {
      height: 360, autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#fffaf0" }, textColor: "#342f29", attributionLogo: false },
      grid: { vertLines: { color: "#eadfce" }, horzLines: { color: "#eadfce" } },
      rightPriceScale: { borderColor: "#342f29" }, timeScale: { borderColor: "#342f29", timeVisible: true, secondsVisible: false },
      handleScroll: true, handleScale: true,
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(LineSeries, { color: "#f04b24", lineWidth: 3, pointMarkersVisible: true, priceFormat: { type: "price", precision: Math.min(decimals, 9), minMove: 10 ** -Math.min(decimals, 9) } });
    markersRef.current = createSeriesMarkers(seriesRef.current, []);
    initialized.current = false;
    const resize = new ResizeObserver(() => chart.applyOptions({ width: host.current?.clientWidth ?? 0 }));
    resize.observe(host.current);
    return () => { resize.disconnect(); markersRef.current = null; chartRef.current = null; seriesRef.current = null; initialized.current = false; chart.remove(); };
  }, [hasPoints, decimals]);
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const visible = chartRef.current.timeScale().getVisibleRange();
    seriesRef.current.setData(normalized.map(point => ({ ...point, time: point.time as UTCTimestamp })));
    if (!initialized.current || (rangeRef.current === "ALL" && !userMoved.current)) { chartRef.current.timeScale().fitContent(); initialized.current = true; }
    else if (visible) chartRef.current.timeScale().setVisibleRange(visible);
  }, [normalized]);
  useEffect(() => { markersRef.current?.setMarkers(markers); }, [markers]);

  function applyRange(next: string) {
    setRange(next);
    rangeRef.current = next; userMoved.current = false;
    const seconds = next === "1H" ? 3600 : next === "1D" ? 86400 : next === "7D" ? 604800 : 0;
    if (!chartRef.current) return;
    if (!seconds) { chartRef.current.timeScale().fitContent(); return; }
    const to = Math.floor(Date.now() / 1000) as UTCTimestamp;
    chartRef.current.timeScale().setVisibleRange({ from: (to - seconds) as UTCTimestamp, to });
  }
  if (!hasPoints) return <div className="chart-empty">Price history becomes available after the finalized tracker records the market.</div>;
  return <section className="chart-panel" aria-label={`Finalized ${baseSymbol} / ${quoteSymbol} price chart`}><div className="chart-head"><div><div className="section-label">Finalized market price</div><h3>{baseSymbol} / {quoteSymbol}</h3></div><div className="chart-ranges" aria-label="Chart timeframes">{["1H", "1D", "7D", "ALL"].map((item) => <button type="button" className={range === item ? "active" : ""} key={item} onClick={() => applyRange(item)}>{item}</button>)}</div></div><div ref={host} className="chart-host" onPointerDown={() => { userMoved.current = true; }} onWheel={() => { userMoved.current = true; }} /><p className="notice">Drag to pan. Scroll or pinch to zoom. Data comes from finalized, verified venue account observations.</p></section>;
}
