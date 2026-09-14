"use client";

import { useEffect, useRef, useState } from "react";
import { ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";

export function PriceChart({ points, decimals }: { points: Array<{ block_time: string; price_quote_atoms_per_token: string }>; decimals: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState("ALL");
  useEffect(() => {
    if (!host.current || !points.length) return;
    const chart = createChart(host.current, {
      height: 360, autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#fffaf0" }, textColor: "#342f29", attributionLogo: false },
      grid: { vertLines: { color: "#eadfce" }, horzLines: { color: "#eadfce" } },
      rightPriceScale: { borderColor: "#342f29" }, timeScale: { borderColor: "#342f29", timeVisible: true, secondsVisible: false },
      handleScroll: true, handleScale: true,
    });
    chartRef.current = chart;
    const series = chart.addSeries(LineSeries, { color: "#f04b24", lineWidth: 3, priceFormat: { type: "price", precision: Math.min(decimals, 9), minMove: 10 ** -Math.min(decimals, 9) } });
    const scale = 10 ** decimals;
    series.setData(points.map((item) => ({ time: Math.floor(new Date(item.block_time).getTime() / 1000) as UTCTimestamp, value: Number(item.price_quote_atoms_per_token) / scale })));
    chart.timeScale().fitContent();
    const resize = new ResizeObserver(() => chart.applyOptions({ width: host.current?.clientWidth ?? 0 }));
    resize.observe(host.current);
    return () => { resize.disconnect(); chartRef.current = null; chart.remove(); };
  }, [points, decimals]);

  function applyRange(next: string) {
    setRange(next);
    const seconds = next === "1H" ? 3600 : next === "1D" ? 86400 : next === "7D" ? 604800 : 0;
    if (!chartRef.current) return;
    if (!seconds) { chartRef.current.timeScale().fitContent(); return; }
    const to = Math.floor(Date.now() / 1000) as UTCTimestamp;
    chartRef.current.timeScale().setVisibleRange({ from: (to - seconds) as UTCTimestamp, to });
  }
  if (!points.length) return <div className="chart-empty">Price history becomes available after the finalized tracker records the market.</div>;
  return <section className="chart-panel" aria-label="Live finalized STONK price chart"><div className="chart-head"><div><div className="section-label">Finalized market price</div><h3>Token / STONK</h3></div><div className="chart-ranges" aria-label="Chart timeframes">{["1H", "1D", "7D", "ALL"].map((item) => <button type="button" className={range === item ? "active" : ""} key={item} onClick={() => applyRange(item)}>{item}</button>)}</div></div><div ref={host} className="chart-host" /><p className="notice">Drag to pan. Scroll or pinch to zoom. Data comes from finalized LaunchLab pool observations.</p></section>;
}
