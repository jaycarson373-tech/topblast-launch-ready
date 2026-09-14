export interface PricePoint { slot: number; blockTime: string; priceQuoteAtomsPerToken: bigint }

export function canonicalEpochPrice(input: { observations: PricePoint[]; startTime: Date; endTime: Date; maxGapSeconds: number }) {
  const rows = [...input.observations].sort((a, b) => Date.parse(a.blockTime) - Date.parse(b.blockTime));
  if (rows.length < 2) throw new Error("Insufficient finalized price coverage");
  const start = Math.floor(input.startTime.getTime() / 1000), end = Math.floor(input.endTime.getTime() / 1000);
  if (end <= start) throw new Error("Invalid epoch price interval");
  const times = rows.map((row) => Math.floor(Date.parse(row.blockTime) / 1000));
  if (times[0] - start > input.maxGapSeconds || end - times[times.length - 1] > input.maxGapSeconds) throw new Error("Epoch price boundary coverage is incomplete");
  let weighted = 0n, covered = 0n;
  for (let index = 0; index < rows.length; index += 1) {
    const from = Math.max(start, times[index]);
    const to = Math.min(end, index + 1 < rows.length ? times[index + 1] : end);
    if (index + 1 < rows.length && times[index + 1] - times[index] > input.maxGapSeconds) throw new Error("Epoch price observation gap is too large");
    if (to <= from) continue;
    const seconds = BigInt(to - from);
    weighted += rows[index].priceQuoteAtomsPerToken * seconds;
    covered += seconds;
  }
  if (covered < BigInt(end - start - input.maxGapSeconds)) throw new Error("Epoch price duration coverage is incomplete");
  const twap = weighted / covered;
  const spot = rows[rows.length - 1].priceQuoteAtomsPerToken;
  return { priceQuoteAtomsPerToken: spot > twap ? spot : twap, twap, spot, startSlot: rows[0].slot, endSlot: rows[rows.length - 1].slot };
}
