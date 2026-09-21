export function VenueBadge({ venue }: { venue: string }) {
  if (venue !== "stonkfun" && venue !== "pumpfun") return null;
  return <span className={`venue-badge venue-theme-${venue}`}><span className="venue-dot" aria-hidden="true" />{venue === "pumpfun" ? "Pump.fun" : "StonkFun"}</span>;
}
