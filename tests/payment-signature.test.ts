import { describe, expect, it } from "vitest";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
describe("payment receipt ID", () => {
  it("encodes the first signature with leading zero bytes preserved", () => {
    const bytes = new Uint8Array(66); bytes[0] = 1; bytes[64] = 1;
    expect(paymentSignatureFromTransaction(bytes)).toBe("1".repeat(63) + "2");
  });
  it("rejects unsigned and truncated transactions", () => {
    const bytes = new Uint8Array(66); bytes[0] = 1;
    expect(() => paymentSignatureFromTransaction(bytes)).toThrow("not signed");
    expect(() => paymentSignatureFromTransaction(new Uint8Array([1, 2]))).toThrow();
  });
});
