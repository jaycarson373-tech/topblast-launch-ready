"use client";
import { useState } from "react";
import { PriceChart } from "@/components/price-chart";
import { formatTokenAtoms as atoms, tokenVenueUrl } from "@/lib/token-display";
import type { TokenMarketData } from "@/lib/token-market-data";
import type { PublicTrade } from "@/lib/token-trades";
export type { PublicTrade } from "@/lib/token-trades";

const money = (value: unknown, price = false) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: price ? "standard" : "compact", maximumFractionDigits: price ? 9 : 2 }).format(value) : "Unavailable";
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-6)}`;

export function MarketOverview({ address, launch, market, spot, prices, trades = [], tradesAvailable, tradesPartial, trackedHolders }: {
  address: string; launch: Record<string, unknown>; market: Record<string, unknown> | null; spot?: TokenMarketData;
  prices: Array<{ block_time: string; price_quote_atoms_per_token: string }>; trades?: PublicTrade[]; tradesAvailable?: boolean; tradesPartial?: boolean; trackedHolders?: number | null;
}) {
  const [side, setSide] = useState("buy"), [filter, setFilter] = useState("all");
  const quote = String(launch.quote_symbol), symbol = String(launch.symbol);
  const decimals = Number(market?.quote_decimals ?? 9), baseDecimals = Number(market?.base_decimals ?? 6);
  const caughtUp = market?.history_complete === true;
  const venue = launch.venue === "pumpfun" ? "Pump.fun" : "StonkFun", url = tokenVenueUrl(String(launch.venue), address);
  const latest = prices.at(-1);
  const points = spot?.status === "available" && spot.observedAt && spot.priceAtoms ? [...prices, { block_time: spot.observedAt, price_quote_atoms_per_token: spot.priceAtoms }] : prices;
  const price = spot?.priceAtoms ?? latest?.price_quote_atoms_per_token;
  const priceTime = spot?.observedAt ?? latest?.block_time;
  const visible = trades.filter(trade => filter === "all" || trade.kind === filter);
  return <>
    <div className="stats-grid market-metrics"><div className="metric"><span>Finalized spot price</span><strong>{price ? `${atoms(price, decimals)} ${quote}` : "Unavailable"}</strong><small>{money(spot?.priceUsd, true)}</small></div><div className="metric"><span>Market cap</span><strong>{money(spot?.marketCapUsd ?? launch.market_cap_usd)}</strong><small>{spot?.marketCapQuoteAtoms ? `${atoms(spot.marketCapQuoteAtoms, decimals)} ${quote}` : "USD data may lag the venue listing"}</small></div><div className="metric"><span>24h volume · venue</span><strong>{money(launch.volume_24h_usd)}</strong></div><div className="metric"><span>Liquidity · venue</span><strong>{money(launch.liquidity_usd)}</strong></div></div>
    <div className="token-market-layout"><div><PriceChart points={points} trades={trades} decimals={decimals} baseSymbol={symbol} quoteSymbol={quote} />{priceTime && <p className="notice">Price observed {new Date(priceTime).toLocaleString()}. USD values use the venue’s separate quote-asset conversion, not a guaranteed execution price.</p>}{spot?.status === "unavailable" && <p className="notice">Current spot observation is unavailable. Any plotted history is labelled by its observation time.</p>}</div>
      <aside className={`panel token-trade-panel venue-theme-${String(launch.venue)}`} aria-label="Buy or sell this token"><div className="section-label">TRADE ${symbol}</div><h3>Your venue.<br />Your wallet.</h3><div className="trade-tabs" role="group" aria-label="Trade direction"><button type="button" aria-pressed={side === "buy"} className={side === "buy" ? "buy active" : "buy"} onClick={() => setSide("buy")}>Buy</button><button type="button" aria-pressed={side === "sell"} className={side === "sell" ? "sell active" : "sell"} onClick={() => setSide("sell")}>Sell</button></div><p>{side === "buy" ? `${quote} → ${symbol}` : `${symbol} → ${quote}`}</p><a className="button venue-button" href={url} target="_blank" rel="noopener noreferrer">{side === "buy" ? "Buy" : "Sell"} on {venue} ↗</a><p className="notice">Opens this token at {venue}. Choose {side}, review the venue quote and slippage, then approve in your wallet. Trading is completed at the venue, not inside TopBlast.</p>{side === "sell" && <p className="notice">Selling excludes your wallet from rewards for that epoch.</p>}<div className="token-external-links"><a href={url} target="_blank" rel="noreferrer">{venue} token page ↗</a><a href={`https://solscan.io/token/${address}`} target="_blank" rel="noreferrer">Token on Solscan ↗</a></div></aside>
    </div>
    <div className="stats-grid"><div className="metric"><span>Token supply</span><strong>{spot?.supplyRaw ? atoms(spot.supplyRaw, baseDecimals) : "Unavailable"}</strong></div><div className="metric"><span>Tracked holders{caughtUp ? "" : " · partial"}</span><strong>{trackedHolders ?? "Unavailable"}</strong></div><div className="metric"><span>Created</span><strong>{new Date(String(launch.created_at)).toLocaleDateString()}</strong></div><div className="metric"><span>Last indexed slot</span><strong>{String(market?.last_indexed_slot ?? "Unavailable")}</strong></div></div>
    <section className="panel token-trades"><div className="trades-heading"><div><div className="section-label">VERIFIED MARKET ACTIVITY</div><h3>Recent trades</h3></div><div className="chart-ranges" role="group" aria-label="Filter trades">{[["all", "All"], ["verified_buy", "Buys"], ["sell", "Sells"]].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      {tradesAvailable === false ? <p className="error">Trade history is temporarily unavailable. Retry the refresh.</p> : !visible.length ? <p className="notice">No matching verified trades recorded yet.</p> : <div className="trade-table-scroll"><table className="proof-table"><thead><tr><th>Activity</th><th>{symbol}</th><th>{quote}</th><th>Finalized</th><th>Receipt</th></tr></thead><tbody>{visible.map(trade => <tr key={trade.id}><td className={trade.kind === "verified_buy" ? "trade-buy" : "trade-sell"}><a className="mono" href={`https://solscan.io/account/${trade.wallet}`} target="_blank" rel="noreferrer">{short(trade.wallet)}</a> {trade.kind === "verified_buy" ? "Topblasted" : "sold"}</td><td>{atoms(trade.token_raw, baseDecimals)}</td><td>{atoms(trade.quote_atoms, decimals)}</td><td>{trade.block_time ? new Date(trade.block_time).toLocaleTimeString() : `Slot ${trade.slot}`}</td><td><a href={`https://solscan.io/tx/${trade.signature}`} target="_blank" rel="noreferrer">View ↗</a></td></tr>)}</tbody></table></div>}{tradesPartial && <p className="notice">A recent receipt is still finalizing. It will appear automatically.</p>}<p className="notice">Every verified finalized buy and sell is shown. There is no minimum trade-size filter.</p>
    </section>
  </>;
}
