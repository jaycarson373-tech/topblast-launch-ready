import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ wallet: vi.fn(), signer: vi.fn(), sign: vi.fn(), prepare: vi.fn(), submit: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/payout/launch-wallet", () => ({ getLaunchWallet: mocks.wallet }));
vi.mock("@/lib/payout/launch-signer", () => ({ createLaunchSigner: mocks.signer }));
vi.mock("@/lib/payout/service", () => ({ preparePayoutBatch: mocks.prepare, submitPayoutBatch: mocks.submit, reconcilePayoutBatch: mocks.reconcile }));
import { processAutomaticPayout } from "@/lib/payout/automatic";

const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PAYOUT_MODE: "server_signer", DRY_RUN: "false", TOPBLAST_TREASURY_ADDRESS: "main", TOPBLAST_MAX_PAYOUT_ATOMS: "100" };
const batch = { id: "batch-a", launch_id: "a", status: "prepared", amount_atoms: "20", asset_mint: "quote-a", unsigned_transaction: "bound-bytes", unsigned_message_hash: "bound-hash" };
function dbFixture({ planned = false, lease = true, inFlight = false } = {}) {
  const rpc = vi.fn(async () => ({ data: lease, error: null }));
  return { rpc, from: () => {
    let selectedStatus = "", many = false;
    const result = () => ({ data: many ? (inFlight ? [{ id: "original-batch", signature: "original-signature" }] : []) : selectedStatus === (planned ? "planned" : "prepared") ? { ...batch, status: selectedStatus } : null, error: null });
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (_: string, value: string) => { selectedStatus = value; return query; },
      in: () => { many = true; return query; },
      maybeSingle: async () => result(),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallet.mockResolvedValue({ address: "creator", role: "topblast_creator", status: "active", binding: { launchId: "a", rewardMint: "quote-a" } });
  mocks.signer.mockReturnValue({ signTransaction: mocks.sign });
  mocks.sign.mockReturnValue("signed-bound-bytes");
  mocks.prepare.mockResolvedValue(batch);
  mocks.submit.mockResolvedValue({ status: "confirmed", signature: "sig-a" });
  mocks.reconcile.mockResolvedValue({ status: "submitted", signature: "original-signature" });
});

it("uses the selected launch's wallet and claims its own lease despite an inherited main lease", async () => {
  const db = dbFixture();
  expect(await processAutomaticPayout(db as unknown as SupabaseClient, "worker", env, "main")).toMatchObject({ status: "confirmed", signature: "sig-a" });
  expect(db.rpc).toHaveBeenCalledWith("claim_worker_lease", expect.objectContaining({ p_resource_id: "creator" }));
  expect(mocks.sign).toHaveBeenCalledWith({ transactionBase64: "bound-bytes", expectedMessageHash: "bound-hash", expectedPayer: "creator" });
  expect(mocks.submit).toHaveBeenCalledWith("batch-a", "signed-bound-bytes");
});
it("does not prepare or sign when another worker owns this wallet's lease", async () => {
  expect(await processAutomaticPayout(dbFixture({ planned: true, lease: false }) as unknown as SupabaseClient, "worker", env)).toEqual({ status: "lease_busy" });
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
});
it("prepares a planned batch only after claiming the correct lease", async () => {
  const db = dbFixture({ planned: true });
  await processAutomaticPayout(db as unknown as SupabaseClient, "worker", env);
  expect(db.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
  expect(mocks.prepare).toHaveBeenCalledWith("batch-a");
});
it("waits for an existing signed receipt before creating another payout", async () => {
  expect(await processAutomaticPayout(dbFixture({ inFlight: true }) as unknown as SupabaseClient, "worker", env)).toMatchObject({ status: "awaiting_finality", signature: "original-signature" });
  expect(mocks.reconcile).toHaveBeenCalledWith("original-batch");
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("blocks a batch using a different launch reward asset", async () => {
  mocks.wallet.mockResolvedValue({ address: "creator", status: "active", binding: { rewardMint: "quote-b" } });
  await expect(processAutomaticPayout(dbFixture() as unknown as SupabaseClient, "worker", env)).rejects.toThrow("asset does not match");
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("enforces the funded payout authorization ceiling before signing", async () => {
  expect(await processAutomaticPayout(dbFixture() as unknown as SupabaseClient, "worker", { ...env, TOPBLAST_MAX_PAYOUT_ATOMS: "19" })).toMatchObject({ status: "authorization_limit" });
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("does not bypass a paused launch or dry-run mode", async () => {
  expect(await processAutomaticPayout(dbFixture() as unknown as SupabaseClient, "worker", { ...env, DRY_RUN: "true" })).toEqual({ status: "disabled" });
  mocks.wallet.mockResolvedValue({ status: "paused" });
  await expect(processAutomaticPayout(dbFixture() as unknown as SupabaseClient, "worker", env)).rejects.toThrow("paused");
  expect(mocks.sign).not.toHaveBeenCalled();
});
