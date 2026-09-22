export function formatTokenAtoms(value: unknown, decimals: number): string {
  if (value === null || value === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^\d+$/.test(String(value))) return "Unavailable";
  const raw = BigInt(String(value)), scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / scale}${decimals && fraction ? `.${fraction}` : ""}`;
}
export function tokenVenueUrl(venue: string, address: string) {
  return venue === "pumpfun" ? `https://pump.fun/coin/${encodeURIComponent(address)}` : `https://www.stonkfun.xyz/token/${encodeURIComponent(address)}`;
}
