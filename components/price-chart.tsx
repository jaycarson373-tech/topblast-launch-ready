"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { chartPoints } from "@/lib/chart-points";

export function PriceChart({ points, decimals, quoteSymbol = "STONK" }: { quoteSymbol?: string; points: Array<{ block_time: string; price_quote_atoms_per_token: string }>; decimals: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const initialized = useRef(false);
  const userMoved = useRef(false);
  const rangeRef = useRef("ALL");
  const normalized = useMemo(() => chartPoints(points, decimals), [points, decimals]);
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
    initialized.current = false;
    const resize = new ResizeObserver(() => chart.applyOptions({ width: host.current?.clientWidth ?? 0 }));
    resize.observe(host.current);
    return () => { resize.disconnect(); chartRef.current = null; seriesRef.current = null; initialized.current = false; chart.remove(); };
  }, [hasPoints, decimals]);
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const visible = chartRef.current.timeScale().getVisibleRange();
    seriesRef.current.setData(normalized.map(point => ({ ...point, time: point.time as UTCTimestamp })));
    if (!initialized.current || (rangeRef.current === "ALL" && !userMoved.current)) { chartRef.current.timeScale().fitContent(); initialized.current = true; }
    else if (visible) chartRef.current.timeScale().setVisibleRange(visible);
  }, [normalized]);

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
  return <section className="chart-panel" aria-label={`Finalized ${quoteSymbol} price chart`}><div className="chart-head"><div><div className="section-label">Finalized market price</div><h3>Token / {quoteSymbol}</h3></div><div className="chart-ranges" aria-label="Chart timeframes">{["1H", "1D", "7D", "ALL"].map((item) => <button type="button" className={range === item ? "active" : ""} key={item} onClick={() => applyRange(item)}>{item}</button>)}</div></div><div ref={host} className="chart-host" onPointerDown={() => { userMoved.current = true; }} onWheel={() => { userMoved.current = true; }} /><p className="notice">Drag to pan. Scroll or pinch to zoom. Data comes from finalized, verified venue account observations.</p></section>;
}
