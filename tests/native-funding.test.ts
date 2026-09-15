import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, Transaction, SystemInstruction, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { prepareCheckedTransfer } from "@/lib/solana/checked-transfers";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
afterEach(() => vi.resetAllMocks());
describe("SOL funding wrapping", () => {
  it("wraps only the declared recipient total, then uses checked transfers", async () => {
    const payer = Keypair.generate().publicKey, recipient = Keypair.generate().publicKey;
    mock.rpc.mockImplementation(async (method: string) => method === "getAccountInfo" ? { value: { owner: TOKEN_PROGRAM_ID.toBase58(), data: { parsed: { info: { decimals: 9 } } } } } : method === "getLatestBlockhash" ? { value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 50 } } : { value: { err: null } });
    const result = await prepareCheckedTransfer({ payer: payer.toBase58(), mint: NATIVE_MINT.toBase58(), transfers: [{ recipient: recipient.toBase58(), amountAtoms: 700n }], memo: "TOPBLAST:FUND:isolated", wrapNative: true });
    const tx = Transaction.from(Buffer.from(result.unsignedTransaction, "base64"));
    const native = SystemInstruction.decodeTransfer(tx.instructions.find((ix) => ix.programId.equals(SystemProgram.programId))!);
    expect(native.lamports).toBe(700n);
    expect(native.toPubkey.equals(getAssociatedTokenAddressSync(NATIVE_MINT, payer))).toBe(true);
    expect(tx.instructions.filter((ix) => ix.programId.equals(TOKEN_PROGRAM_ID)).map((ix) => ix.data[0])).toEqual([17, 12]);
    expect(result.destinationTokenAccounts[0].amountAtoms).toBe("700");
    expect(mock.rpc).toHaveBeenCalledWith("simulateTransaction", expect.any(Array));
  });
  it("does not return a payable funding transaction when simulation fails", async () => {
    mock.rpc.mockImplementation(async (method: string) => method === "getAccountInfo" ? { value: { owner: TOKEN_PROGRAM_ID.toBase58(), data: { parsed: { info: { decimals: 9 } } } } } : method === "getLatestBlockhash" ? { value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 50 } } : { value: { err: "InsufficientFunds" } });
    await expect(prepareCheckedTransfer({ payer: Keypair.generate().publicKey.toBase58(), mint: NATIVE_MINT.toBase58(), transfers: [{ recipient: Keypair.generate().publicKey.toBase58(), amountAtoms: 1n }], memo: "test", wrapNative: true })).rejects.toThrow("simulation failed");
  });
});
