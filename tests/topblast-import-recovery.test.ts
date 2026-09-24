import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import creation from "./fixtures/top-public-creation.json";
const mocks = vi.hoisted(() => ({ register: vi.fn(), inspect: vi.fn(), rpc: vi.fn(), signer: vi.fn(), wallet: vi.fn() }));
vi.mock("@/lib/db/launch-repository", () => ({ registerLaunchTracker: mocks.register }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
vi.mock("@/lib/solana/launchlab", async original => ({ ...await original<Record<string, unknown>>(), inspectLaunchLabMarket: mocks.inspect }));
vi.mock("@/lib/payout/launch-signer", () => ({ createLaunchSigner: () => ({ publicKey: mocks.signer }) }));
vi.mock("@/lib/payout/launch-wallet", () => ({ getLaunchWallet: mocks.wallet }));
import { ensureTopblastCreatorLaunch } from "@/lib/db/topblast-import";
import { TOKEN_PROGRAM } from "@/lib/solana/launchlab-constants";
const mint = "85iZwkRNwUs8q9sfLJCXhiVsny4faMyf5nbDQZ7x6omB";
const creator = "2A3RvpbHkcgL5XTkqdxYXb6Ywp1pXRSodF8W6bx7GST9";
const pool = "CdKtdZVcn9zDKoivtKjZbACHXs4Uau3TXK6BtqhdcowB";
const quote = "So11111111111111111111111111111111111111112";
type Row = Record<string, unknown>;
function database() {
  const tables: Record<string, Row[]> = { launches: [], launch_configs: [], launch_creators: [], system_config: [] };
  const writes: string[] = [];
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const db = { rpc, from: (table: string) => {
    let operation = "select", payload: Row = {};
    const filters: Array<[string, unknown]> = [];
    const execute = async () => {
      const rows = tables[table];
      if (!rows) throw new Error(`Unexpected table ${table}`);
      const found = rows.find(row => filters.every(([key, value]) => row[key] === value));
      if (operation === "insert") { writes.push(table); const row = { id: `${table}-${rows.length}`, ...payload }; rows.push(row); return { data: row, error: null }; }
      if (operation === "update") { if (found) Object.assign(found, payload); return { data: found, error: null }; }
      if (operation === "upsert") { const key = table === "system_config" ? "key" : "launch_id"; const existing = rows.find(row => row[key] === payload[key]); if (existing) Object.assign(existing, payload); else rows.push({ ...payload }); return { data: null, error: null }; }
      return { data: found ?? null, error: null };
    };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      insert: (value: Row) => { operation = "insert"; payload = value; return query; }, update: (value: Row) => { operation = "update"; payload = value; return query; }, upsert: (value: Row) => { operation = "upsert"; payload = value; return query; },
      single: execute, maybeSingle: execute, then: (resolve: (value: unknown) => unknown) => execute().then(resolve),
    };
    return query;
  } };
  return { db: db as unknown as SupabaseClient, tables, writes, rpc };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TOPBLAST_TOKEN_MINT", mint); vi.stubEnv("TOPBLAST_CREATOR_ADDRESS", creator);
  vi.stubEnv("TOPBLAST_TREASURY_ADDRESS", "AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42");
  vi.stubEnv("TOPBLAST_LAUNCH_SIGNATURE", creation.transaction.signatures[0]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { network: "mainnet-beta", token: { mint, pool, name: "TOP", symbol: "TOP", quote: { mint: quote, symbol: "SOL" } }, launch: { creator } } }))));
  mocks.rpc.mockResolvedValue(creation);
  mocks.inspect.mockResolvedValue({ quoteTokenProgram: TOKEN_PROGRAM, platformConfigAddress: "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7", launchSlot: creation.slot });
  mocks.signer.mockReturnValue(creator);
  mocks.register.mockResolvedValue(true);
  mocks.wallet.mockResolvedValue({ role: "topblast_creator", binding: {} });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("registers an external launch without fabricating a payment and does not insert again after restart", async () => {
  const { db, tables, writes } = database();
  expect(await ensureTopblastCreatorLaunch(db, "worker-a")).toMatchObject({ status: "active" });
  expect(await ensureTopblastCreatorLaunch(db, "worker-b")).toMatchObject({ status: "active" });
  expect(writes).toEqual(["launches", "launch_configs"]);
  expect(tables.launches[0]).toMatchObject({ listing_hidden: false, venue_payload: { submittedByPlatform: false, origin: "external_stonk_bundle" }, launch_signature: creation.transaction.signatures[0] });
  expect(tables.launches[0]).not.toHaveProperty("payment_signature");
  expect(tables.launch_configs[0]).toMatchObject({ treasury_address: creator, topblast_percent: 90, creator_percent: 0, protocol_percent: 10 });
  expect(tables.system_config).toEqual([expect.objectContaining({ key: "topblast_registered_mint", value: mint })]);
});
it("keeps a failed registration hidden and resumes the same launch and configuration", async () => {
  const { db, tables, writes } = database();
  mocks.register.mockResolvedValueOnce(false);
  await expect(ensureTopblastCreatorLaunch(db, "worker-a")).rejects.toThrow("registration will retry");
  expect(tables.launches[0]).toMatchObject({ status: "prepared", listing_hidden: true });
  expect(tables.system_config).toEqual([]);
  expect(await ensureTopblastCreatorLaunch(db, "worker-b")).toMatchObject({ status: "active", launchId: "launches-0" });
  expect(writes).toEqual(["launches", "launch_configs"]);
});
it("refuses to reassign an existing platform launch to the external creator wallet", async () => {
  const { db, tables, writes } = database();
  tables.launches.push({ id: "existing", mint, creator_wallet: creator, venue_payload: {}, status: "active" });
  await expect(ensureTopblastCreatorLaunch(db, "worker")).rejects.toThrow("cannot be reassigned");
  expect(writes).toEqual([]);
  expect(mocks.register).not.toHaveBeenCalled();
});
it("refuses signer failure before creating any launch row", async () => {
  mocks.signer.mockImplementation(() => { throw new Error("Signer mismatch"); });
  const { db, writes } = database();
  await expect(ensureTopblastCreatorLaunch(db, "worker")).rejects.toThrow("Signer mismatch");
  expect(writes).toEqual([]);
});
it("makes no changes without a mint or when another worker owns registration", async () => {
  const { db, writes, rpc } = database();
  vi.stubEnv("TOPBLAST_TOKEN_MINT", "");
  expect(await ensureTopblastCreatorLaunch(db, "worker")).toEqual({ status: "awaiting_mint" });
  expect(rpc).not.toHaveBeenCalled();
  vi.stubEnv("TOPBLAST_TOKEN_MINT", mint); rpc.mockResolvedValue({ data: false, error: null });
  expect(await ensureTopblastCreatorLaunch(db, "worker")).toEqual({ status: "lease_busy" });
  expect(writes).toEqual([]);
});
