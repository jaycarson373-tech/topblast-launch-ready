import { describe, expect, it } from "vitest";
import { allocationReceipt } from "../lib/rewards/public-proof";
const allocation = { epoch_id: "epoch-a", wallet: "wallet-a", amount_atoms: "10" };
describe("recipient-specific public payout proof", () => {
  it("does not call another wallet or epoch's confirmed payment paid", () => {
    for (const payment of [{ ...allocation, wallet: "wallet-b" }, { ...allocation, epoch_id: "epoch-b" }]) {
      expect(allocationReceipt(allocation, [{ ...payment, status: "confirmed", signature: "receipt" }]).paidAtoms).toBe("0");
    }
  });
  it("keeps failed, submitted, unsigned, mismatched and missing payments unpaid", () => {
    for (const payment of [{ status: "failed", signature: "receipt" }, { status: "submitted", signature: "receipt" }, { status: "confirmed", signature: null }, { status: "confirmed", signature: "receipt", amount_atoms: "9" }]) {
      expect(allocationReceipt(allocation, [{ ...allocation, ...payment }]).paidAtoms).toBe("0");
    }
    expect(allocationReceipt(allocation, []).status).toBe("REWARD RESERVED");
  });
  it("requires this recipient's exact finalized payment and receipt", () => {
    expect(allocationReceipt(allocation, [{ ...allocation, status: "confirmed", signature: "receipt" }])).toEqual({ paidAtoms: "10", status: "PAYOUT CONFIRMED", signature: "receipt" });
  });
});
