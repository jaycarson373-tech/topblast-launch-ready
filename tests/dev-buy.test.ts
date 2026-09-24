import { describe, expect, it } from "vitest";
import { Keypair, SystemInstruction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { devBuyAtoms, stonkBuyQuoteInstructions } from "@/lib/solana/dev-buy";

describe("dev-buy exact spending cap", () => {
  it("uses exact integers at the selected mint precision", () => {
    expect(devBuyAtoms(undefined, 9)).toBe(0n);
    expect(devBuyAtoms("0.001", 9)).toBe(1_000_000n);
    expect(devBuyAtoms("9007199254.740993", 6)).toBe(9007199254740993n);
    expect(devBuyAtoms("1", 0)).toBe(1n);
  });
  it("rejects invalid amounts, precision and overflow", () => {
    for (const text of ["-1", "NaN", "1e3", " 1", "01", "1.0000001"]) expect(() => devBuyAtoms(text, 6)).toThrow();
    expect(() => devBuyAtoms("18446744073709551616", 0)).toThrow("limit");
    expect(() => devBuyAtoms("1", 19)).toThrow("decimals");
  });
  it("wraps only the chosen native amount and never closes an existing ATA", () => {
    const payer = Keypair.generate().publicKey;
    const ix = stonkBuyQuoteInstructions(payer, NATIVE_MINT, 12345n);
    expect(ix).toHaveLength(3);
    expect(SystemInstruction.decodeTransfer(ix[1])).toMatchObject({ fromPubkey: payer, lamports: 12345n });
    expect(ix[2].data[0]).toBe(17); // SyncNative, not CloseAccount.
    expect(stonkBuyQuoteInstructions(payer, Keypair.generate().publicKey, 12345n)).toEqual([]);
  });
});
