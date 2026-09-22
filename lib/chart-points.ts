export function chartPoints(points: Array<{ block_time: string; price_quote_atoms_per_token: string }>, decimals: number) {
  const byTime = new Map<number, number>();
  for (const point of points) {
    const time = Math.floor(Date.parse(point.block_time) / 1000);
    const value = Number(point.price_quote_atoms_per_token) / 10 ** decimals;
    if (Number.isFinite(time) && time > 0 && Number.isFinite(value) && value > 0) byTime.set(time, value);
  }
  return [...byTime].sort(([a], [b]) => a - b).map(([time, value]) => ({ time, value }));
}
