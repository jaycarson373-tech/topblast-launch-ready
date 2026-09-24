import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import fixture from "./fixtures/stonk-public-fee-forward.json";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), wallet: vi.fn(), fees: vi.fn(), inspect: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
vi.mock("@/lib/solana/launchlab", async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), inspectLaunchLabMarket: mocks.inspect }));
vi.mock("@/lib/payout/launch-wallet", () => ({ getLaunchWallet: mocks.wallet }));
vi.mock("@/lib/payout/launch-signer", () => ({ createLaunchSigner: () => ({ publicKey: () => "fixture-owner" }) }));
vi.mock("@/lib/venue/stonkfun-adapter", () => ({ StonkFunAdapter: class { getCreatorFees = mocks.fees; } }));
import { processTopblastCreatorFees } from "@/lib/funding/topblast-creator";
import { LAUNCHLAB_PROGRAM, TOKEN_PROGRAM } from "@/lib/solana/launchlab-constants";
const market = { launch_id: "isolated-a", base_mint: "AqoPZcUumKUBHrnfBsNtoNuneYEjoimaiWYq8GH8gpX9", quote_mint: "So11111111111111111111111111111111111111112", market_address: "2NdMyxQWNG7CxjfR2CVvonz8xtRJif4EZGwtZYBmMT2Z", creator_address: "GDLafJUokaU85DFZK2JNhWtNhe5nWQUBQRCWoGJ9cncv", quote_decimals: 9, launch_slot: 450000000, last_indexed_slot: 450084897 };
const sig = fixture.transaction.signatures[0];
function database() {
  const credited: Array<{ signature: string; amount_atoms: string }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "credit_stonk_forwarded_fee") {
      if (credited.some(row => row.signature === args.p_signature)) return { data: false, error: null };
      credited.push({ signature: String(args.p_signature), amount_atoms: String(args.p_amount_atoms) });
    }
    return { data: true, error: null };
  });
  const db = { rpc, from: (table: string) => {
    const result = () => ({ data: table === "fee_events" ? [...credited] : null, error: null });
    const query = { select: () => query, eq: () => query, order: () => query, range: () => query, limit: () => query, maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  } };
  return { db: db as unknown as SupabaseClient, rpc, credited };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DRY_RUN", "false"); vi.stubEnv("PAYOUT_MODE", "server_signer");
  mocks.wallet.mockResolvedValue({ address: market.creator_address, role: "topblast_creator", status: "active", binding: { mint: market.base_mint } });
  mocks.inspect.mockResolvedValue({ quoteTokenProgram: TOKEN_PROGRAM, quoteDecimals: 9 });
  mocks.fees.mockResolvedValue({ raw: { creator: market.creator_address }, forwarding: { quoteMint: market.quote_mint, decimals: 9, lastSignature: sig, creatorQuoteForwardedAtoms: "101790550" } });
  mocks.rpc.mockImplementation(async (method: string) => {
    if (method === "getProgramAccounts") return [{ pubkey: market.market_address, account: { owner: LAUNCHLAB_PROGRAM } }];
    if (method === "getTransaction") return structuredClone(fixture);
    if (method === "getSignaturesForAddress") return [{ signature: sig, slot: fixture.slot, err: null, confirmationStatus: "finalized" }];
    throw new Error(method);
  });
});
afterEach(() => vi.unstubAllEnvs());
it("credits a verified forward once, with exact launch and signature binding, across restart", async () => {
  const { db, rpc, credited } = database();
  expect(await processTopblastCreatorFees(db, market, "worker")).toMatchObject({ status: "credited", credited: 1 });
  expect(await processTopblastCreatorFees(db, market, "restarted-worker")).toMatchObject({ status: "idle", credited: 0 });
  expect(credited).toEqual([{ signature: sig, amount_atoms: "101790550" }]);
  expect(rpc).toHaveBeenCalledWith("credit_stonk_forwarded_fee", expect.objectContaining({ p_launch_id: market.launch_id, p_signature: sig, p_amount_atoms: "101790550" }));
});
it("refuses attribution when the wallet has two pools", async () => {
  mocks.rpc.mockResolvedValueOnce([{ pubkey: market.market_address, account: { owner: LAUNCHLAB_PROGRAM } }, { pubkey: "other" }]);
  const { db, credited } = database();
  await expect(processTopblastCreatorFees(db, market, "worker")).rejects.toThrow("exactly one");
  expect(credited).toEqual([]);
});
it("does not credit a forward beyond finalized indexed history", async () => {
  const { db, credited } = database();
  expect(await processTopblastCreatorFees(db, { ...market, last_indexed_slot: fixture.slot - 1 }, "worker")).toMatchObject({ status: "awaiting_index" });
  expect(credited).toEqual([]);
});
it("rejects another mint or creator before consulting the venue", async () => {
  const { db } = database();
  await expect(processTopblastCreatorFees(db, { ...market, base_mint: "another-mint" }, "worker")).rejects.toThrow("identity mismatch");
  expect(mocks.fees).not.toHaveBeenCalled();
});
it("never turns projected or reported revenue into funding without a transaction", async () => {
  mocks.fees.mockResolvedValue({ raw: { creator: market.creator_address }, forwarding: { quoteMint: market.quote_mint, decimals: 9, creatorQuoteForwardedAtoms: "1000000000" } });
  const { db, credited } = database();
  expect(await processTopblastCreatorFees(db, market, "worker")).toMatchObject({ status: "awaiting_venue_forward" });
  expect(credited).toEqual([]);
});
it("rejects receipt totals exceeding the venue's forwarded amount", async () => {
  mocks.fees.mockResolvedValue({ raw: { creator: market.creator_address }, forwarding: { quoteMint: market.quote_mint, decimals: 9, lastSignature: sig, creatorQuoteForwardedAtoms: "99" } });
  const { db, credited } = database();
  await expect(processTopblastCreatorFees(db, market, "worker")).rejects.toThrow("exceed");
  expect(credited).toEqual([]);
});
it("reports missing receipt attribution without crediting an estimated difference", async () => {
  mocks.fees.mockResolvedValue({ raw: { creator: market.creator_address }, forwarding: { quoteMint: market.quote_mint, decimals: 9, lastSignature: sig, creatorQuoteForwardedAtoms: "101790551" } });
  const { db, credited } = database();
  expect(await processTopblastCreatorFees(db, market, "worker")).toMatchObject({ status: "reconciliation_required", credited: 1, unverifiedAtoms: "1" });
  expect(credited[0].amount_atoms).toBe("101790550");
});
