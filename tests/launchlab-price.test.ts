import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
import { observeLaunchLabPrice, LAUNCHLAB_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/launchlab";
const key = "11111111111111111111111111111111";
const market = { launchId: "a", marketAddress: key, baseMint: key, quoteMint: key, creatorAddress: key, configAddress: key, platformConfigAddress: key, baseVault: key, quoteVault: key, tokenDecimals: 6, baseTokenProgram: TOKEN_PROGRAM, quoteTokenProgram: TOKEN_PROGRAM };
let bytes: Buffer;
beforeEach(() => {
  bytes = Buffer.alloc(429); Buffer.from([247,237,227,245,215,195,222,70]).copy(bytes);
  bytes.writeBigUInt64LE(1_000_000n, 37); bytes.writeBigUInt64LE(1_000_000_000n, 45);
  mock.rpc.mockImplementation(async (method: string) => method === "getBlockTime" ? 1790099631 : { context: { slot: 100 }, value: { owner: LAUNCHLAB_PROGRAM, data: [bytes.toString("base64"), "base64"] } });
});
it("changes spot price after a buy using official effective-reserve semantics", async () => {
  expect((await observeLaunchLabPrice(market)).priceQuoteAtomsPerToken).toBe(1_000_000_000n);
  bytes.writeBigUInt64LE(100_000n, 53); bytes.writeBigUInt64LE(100_000_000n, 61);
  expect((await observeLaunchLabPrice(market)).priceQuoteAtomsPerToken).toBe(1_222_222_222n);
});
it("rejects exhausted effective base reserves", async () => {
  bytes.writeBigUInt64LE(1_000_000n, 53);
  await expect(observeLaunchLabPrice(market)).rejects.toThrow("effective reserves");
});
