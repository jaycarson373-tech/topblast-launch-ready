import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUMP_SDK, PUMP_PROGRAM_ID, pumpIdl, feeSharingConfigPda, type DistributeCreatorFeesEvent } from "@/lib/solana/pump-sdk";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), exact: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc, solanaRpcUrl: () => "https://unused.invalid" }));
vi.mock("@/lib/solana/checked-transfers", () => ({ verifyFinalizedSignedTransaction: mocks.exact, broadcastSignedCheckedTransfer: mocks.broadcast }));
import { creditConfirmedDistributions, reconcilePumpFeeOperation } from "@/lib/funding/pump-auto";

const treasury = new PublicKey("AeYBHj5vf6P9DPHFcewsLdMp3atNfm1RxZ3gSK49Xo42");
const market = { launch_id: "launch-a", launch_slot: 450048180, last_indexed_slot: 450050000, base_mint: "7vt4NxCCBRtyj4kkpiKNZRnHbgJkAww4qsDn4DxKeaM", market_address: "2FYnahgrpKHUoLHoNL3UiQskW1DMYzx4T3jNM1WSZqwF", quote_mint: "So11111111111111111111111111111111111111112", quote_token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", creator_address: treasury.toBase58() };
const signature = "47urtTnyEiS8o3oAuD2W4sEyjYaW9zEGoLyBDH7uUh6rpx1JAcAmbLZkqDCbLpnCCNqjTUDy84m6zrgxbh3a5qdm";
const operation = { id: "op-a", launch_id: market.launch_id, kind: "distribute" as const, status: "submitted", idempotency_key: "fixture", signed_transaction: "saved-bytes", signature };

function encodedEvent() {
  const tag = (pumpIdl.events as Array<{ name: string; discriminator: number[] }>).find(e => e.name.toLowerCase() === "distributecreatorfeesevent")!.discriminator;
  let n = BigInt(`0x${Buffer.from([228,69,165,46,81,203,154,29,...tag,0]).toString("hex")}`), out = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return out;
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  mocks.exact.mockResolvedValue({ signature, slot: 450049981, transactionHash: "fixture-hash" });
  vi.spyOn(PUMP_SDK, "decodeDistributeCreatorFeesEvent").mockReturnValue({ mint: new PublicKey(market.base_mint), bondingCurve: new PublicKey(market.market_address), sharingConfig: feeSharingConfigPda(new PublicKey(market.base_mint)), admin: treasury, quoteMint: PublicKey.default, shareholders: [{ address: treasury, shareBps: 10000 }], distributed: { toString: () => "0" } } as unknown as DistributeCreatorFeesEvent);
  mocks.rpc.mockResolvedValue({ slot: 450049981, blockTime: 1790258501, meta: { err: null, fee: 5000, preBalances: [24312602], postBalances: [24307602], innerInstructions: [{ instructions: [{ programId: PUMP_PROGRAM_ID.toBase58(), data: encodedEvent() }] }] }, transaction: { signatures: [signature], message: { accountKeys: [treasury.toBase58()], instructions: [] } } });
});

describe("empty Pump collection recovery (simulated RPC, real incident amounts)", () => {
  it("persists the original empty receipt, confirms once, and never rebroadcasts on restart", async () => {
    const proofs: Record<string, unknown>[] = [], updates: Record<string, unknown>[] = [];
    const db = { from(table: string) {
      if (table === "transaction_proofs") return { upsert: async (value: Record<string, unknown>) => { proofs.push(value); return { error: null }; } };
      return { update(value: Record<string, unknown>) {
        updates.push(value);
        const query = { eq: () => query, neq: () => query, select: () => query, single: async () => ({ data: { ...operation, ...value }, error: null }) };
        return query;
      } };
    } } as unknown as SupabaseClient;
    const confirmed = await reconcilePumpFeeOperation(db, operation, market, treasury);
    expect(confirmed).toMatchObject({ status: "confirmed", amount_atoms: null, signature, proof: { type: "pump_fee_distribution_empty", amountAtoms: "0" } });
    await reconcilePumpFeeOperation(db, confirmed, market, treasury);
    expect(updates).toHaveLength(1); expect(proofs).toHaveLength(1);
    expect(mocks.exact).toHaveBeenCalledOnce(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("never credits an empty collection or creates a zero-value creator/reward allocation", async () => {
    const rpc = vi.fn();
    const query = { eq: () => query, order: async () => ({ data: [{ ...operation, status: "confirmed", amount_atoms: null, proof: { type: "pump_fee_distribution_empty", amountAtoms: "0", signature } }], error: null }) };
    const from = vi.fn(() => ({ select: () => query }));
    const db = { from, rpc } as unknown as SupabaseClient;
    expect(await creditConfirmedDistributions(db, market)).toBe(true);
    expect(from).toHaveBeenCalledTimes(1); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not silently skip a malformed positive receipt", async () => {
    const query = { eq: () => query, order: async () => ({ data: [{ ...operation, amount_atoms: null, proof: { type: "pump_fee_distribution", amountAtoms: "100" } }], error: null }) };
    const db = { from: () => ({ select: () => query }), rpc: vi.fn() } as unknown as SupabaseClient;
    await expect(creditConfirmedDistributions(db, market)).rejects.toThrow("positive funding amount");
  });
});
