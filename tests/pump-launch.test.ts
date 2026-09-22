import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import { PumpFunAdapter } from "@/lib/venue/pumpfun-adapter";
import { PUMP_SDK, PUMP_PROGRAM_ID } from "@/lib/solana/pump-sdk";
import { PUMP_SOL_MINT } from "@/lib/solana/pumpfun";
import type { LaunchDraft } from "@/lib/types";

const mocked = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), single: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocked.rpc }));
vi.mock("@/lib/solana/checked-transfers", () => ({ broadcastSignedCheckedTransfer: mocked.broadcast }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ insert: mocked.insert, select: () => ({ eq: () => ({ single: mocked.single }) }) }) }) }));
const genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const publicKey = () => Keypair.generate().publicKey.toBase58();
let balanceCalls: number;
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); balanceCalls = 0;
  vi.spyOn(PUMP_SDK, "decodeGlobal").mockReturnValue({ initialized: true, createV2Enabled: true } as ReturnType<typeof PUMP_SDK.decodeGlobal>);
  mocked.insert.mockResolvedValue({ error: null });
  mocked.single.mockResolvedValue({ data: { signed_quote: JSON.stringify({ venue: "pumpfun", mint: "mint", pool: "pool", lastValidBlockHeight: 200 }), signed_payment_transaction: "saved-wire" }, error: null });
  mocked.rpc.mockImplementation(async (method: string) => {
    if (method === "getGenesisHash") return genesis;
    if (method === "getAccountInfo") return { value: { owner: PUMP_PROGRAM_ID.toBase58(), executable: false, lamports: 1000, data: ["AA==", "base64"] } };
    if (method === "getLatestBlockhash") return { context: { slot: 100 }, value: { blockhash: publicKey(), lastValidBlockHeight: 200 } };
    if (method === "getBalance") { balanceCalls++; return { context: { slot: 100 }, value: 1_000_000_000 }; }
    if (method === "simulateTransaction") return { context: { slot: 100 }, value: { err: null, accounts: [{ lamports: 990_000_000 }] } };
    if (method === "getTransaction") return null;
    if (method === "getBlockHeight") return 100;
    if (method === "getSignatureStatuses") return { value: [null] };
    throw new Error(`Unexpected RPC ${method}`);
  });
});
const draft = (): LaunchDraft => ({ venue: "pumpfun", creatorWallet: publicKey(), pumpMint: publicKey(), name: "TopBlast test", symbol: "TBT", description: "fixture", logo: "data:image/png;base64,iVBORw0KGgo=", quoteMint: PUMP_SOL_MINT, quoteSymbol: "SOL", feeTier: "1%", allocation: { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 } });

describe("Pump.fun preparation and recovery, simulated RPC", () => {
  it("checks the actual global creation switch", async () => {
    vi.mocked(PUMP_SDK.decodeGlobal).mockReturnValue({ initialized: true, createV2Enabled: false } as ReturnType<typeof PUMP_SDK.decodeGlobal>);
    expect((await new PumpFunAdapter().getPair(PUMP_SOL_MINT))?.launchable).toBe(false);
    await expect(new PumpFunAdapter().createLaunch(draft())).rejects.toThrow("disabled token creation");
    expect(mocked.insert).not.toHaveBeenCalled();
  });
  it("rejects a non-mainnet RPC before preparing or broadcasting", async () => {
    mocked.rpc.mockResolvedValue("devnet-genesis");
    await expect(new PumpFunAdapter().createLaunch(draft())).rejects.toThrow("requires Solana mainnet");
    await expect(new PumpFunAdapter().getLaunch("receipt")).rejects.toThrow("requires Solana mainnet");
    expect(mocked.broadcast).not.toHaveBeenCalled();
  });
  it("rejects an unverified global account", async () => {
    mocked.rpc.mockImplementation(async (method) => method === "getGenesisHash" ? genesis : { value: { owner: publicKey(), data: ["AA==", "base64"] } });
    await expect(new PumpFunAdapter().getPair(PUMP_SOL_MINT)).rejects.toThrow("global account");
  });
  it("builds the official create instruction with two required signers and a simulated debit", async () => {
    const input = draft();
    const prepared = await new PumpFunAdapter().createLaunch(input);
    const transaction = Transaction.from(Buffer.from(prepared.paymentTransaction, "base64"));
    expect(transaction.feePayer?.toBase58()).toBe(input.creatorWallet);
    expect(transaction.signatures.map((item) => item.publicKey.toBase58())).toEqual([input.creatorWallet, input.pumpMint]);
    expect(transaction.signatures.every((item) => item.signature === null)).toBe(true);
    expect(prepared.payment.lamports).toBe("10000000");
    expect(prepared.raw.nativeHolderRewards).toBe(false);
    expect(balanceCalls).toBe(2);
    expect(mocked.broadcast).not.toHaveBeenCalled();
    expect(mocked.rpc).toHaveBeenCalledWith("getLatestBlockhash", [{ commitment: "confirmed" }]);
    expect(mocked.rpc).toHaveBeenCalledWith("simulateTransaction", [prepared.paymentTransaction, expect.objectContaining({ commitment: "confirmed", minContextSlot: 100 })]);
  });
  it("refuses a cost quote if the payer balance moved during simulation", async () => {
    const original = mocked.rpc.getMockImplementation()!;
    mocked.rpc.mockImplementation(async (...args) => {
      const result = await original(...args);
      return args[0] === "getBalance" && balanceCalls === 2 ? { ...result, value: 2_000_000_000 } : result;
    });
    await expect(new PumpFunAdapter().createLaunch(draft())).rejects.toThrow("balance changed");
  });
  it("surfaces simulation failure without submitting", async () => {
    const original = mocked.rpc.getMockImplementation()!;
    mocked.rpc.mockImplementation(async (...args) => args[0] === "simulateTransaction" ? { value: { err: { InstructionError: [1, "InsufficientFunds"] } } } : original(...args));
    await expect(new PumpFunAdapter().createLaunch(draft())).rejects.toThrow("simulation failed");
    expect(mocked.broadcast).not.toHaveBeenCalled();
  });
  it("recovers finalized creation from the original receipt without another submission", async () => {
    const original = mocked.rpc.getMockImplementation()!;
    mocked.rpc.mockImplementation(async (...args) => args[0] === "getTransaction" ? { slot: 150, meta: { err: null }, transaction: ["saved-wire", "base64"] } : original(...args));
    expect(await new PumpFunAdapter().getLaunch("receipt")).toMatchObject({ status: "completed", mint: "mint", pool: "pool", paymentSignature: "receipt" });
    expect(mocked.broadcast).not.toHaveBeenCalled();
  });
  it("never accepts different finalized bytes", async () => {
    const original = mocked.rpc.getMockImplementation()!;
    mocked.rpc.mockImplementation(async (...args) => args[0] === "getTransaction" ? { slot: 150, meta: { err: null }, transaction: ["altered-wire", "base64"] } : original(...args));
    await expect(new PumpFunAdapter().getLaunch("receipt")).rejects.toThrow("does not match");
  });
  it("only retries the identical saved transaction when delivery is uncertain", async () => {
    mocked.broadcast.mockRejectedValue(new Error("RPC timeout"));
    expect((await new PumpFunAdapter().getLaunch("receipt")).status).toBe("processing");
    expect(mocked.broadcast).toHaveBeenCalledWith("saved-wire");
    expect(mocked.broadcast).toHaveBeenCalledTimes(1);
  });
  it("does not resend expired transactions", async () => {
    const original = mocked.rpc.getMockImplementation()!;
    mocked.rpc.mockImplementation(async (...args) => args[0] === "getBlockHeight" ? 201 : original(...args));
    expect((await new PumpFunAdapter().getLaunch("receipt")).status).toBe("failed");
    expect(mocked.broadcast).not.toHaveBeenCalled();
  });
});
