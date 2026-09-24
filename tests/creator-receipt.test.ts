import { describe, expect, it } from "vitest";
import { routeFromVenueReceipt, verifyCreatorReceipt, type CreatorReceiptRoute, type FundingTransaction } from "@/lib/funding/creator-receipt";
import { TOKEN_PROGRAM } from "@/lib/solana/launchlab-constants";
import publicForward from "./fixtures/stonk-public-fee-forward.json";

export const signature = "5".repeat(88);
export const route: CreatorReceiptRoute = { mint: "quote", decimals: 9, recipient: "creator", destination: "destination", source: "venue-source", authority: "venue-authority", launchSlot: 10 };
export function receipt(): FundingTransaction {
  const balance = (accountIndex: number, owner: string, amount: string) => ({ accountIndex, mint: route.mint, owner, programId: TOKEN_PROGRAM, uiTokenAmount: { amount } });
  return { slot: 20, blockTime: 1_700_000_000, transaction: { signatures: [signature], message: { accountKeys: [route.source, route.destination], instructions: [{ programId: TOKEN_PROGRAM, parsed: { type: "transferChecked", info: { source: route.source, destination: route.destination, authority: route.authority, mint: route.mint, tokenAmount: { amount: "100", decimals: 9 } } } }] } },
    meta: { err: null, innerInstructions: [], preTokenBalances: [balance(0, route.authority, "200"), balance(1, route.recipient, "0")], postTokenBalances: [balance(0, route.authority, "100"), balance(1, route.recipient, "100")] } };
}
describe("original TopBlast exact funding-receipt checks, adapted per mint", () => {
  it("accepts an archived real Stonk WSOL forwarding receipt (read-only evidence, not our payout)", () => {
    const tx = publicForward as FundingTransaction;
    const recipient = "GDLafJUokaU85DFZK2JNhWtNhe5nWQUBQRCWoGJ9cncv", destination = "B5MKiF2b8hZ3gZ5AHYDm5dL8EQPwAitmmLqiufBGB2qt";
    const learned = routeFromVenueReceipt(tx, destination, "So11111111111111111111111111111111111111112", 9, recipient, 450000000);
    expect(verifyCreatorReceipt(tx, tx.transaction.signatures[0], learned)).toMatchObject({ amountAtoms: "101790550", slot: 450084897, recipient });
  });
  it("verifies route, authority, mint, decimals and both deltas without reading SOL gas as rewards", () => {
    expect(verifyCreatorReceipt(receipt(), signature, route)).toMatchObject({ amountAtoms: "100", mint: "quote", recipient: "creator", slot: 20 });
    expect(routeFromVenueReceipt(receipt(), route.destination, route.mint, route.decimals, route.recipient, 10)).toEqual(route);
  });
  it.each(["mint", "recipient", "destination", "source", "authority"] as const)("rejects the wrong %s", field => {
    expect(() => verifyCreatorReceipt(receipt(), signature, { ...route, [field]: "another-launch" })).toThrow();
  });
  it("rejects failed, unavailable, pre-launch, mismatched-signature and incomplete receipts", () => {
    expect(() => verifyCreatorReceipt(null, signature, route)).toThrow();
    const tx = receipt(); tx.meta!.err = { failed: true };
    expect(() => verifyCreatorReceipt(tx, signature, route)).toThrow();
    expect(() => verifyCreatorReceipt(receipt(), "6".repeat(88), route)).toThrow();
    expect(() => verifyCreatorReceipt(receipt(), signature, { ...route, launchSlot: 21 })).toThrow();
    expect(() => verifyCreatorReceipt({ ...receipt(), blockTime: null }, signature, route)).toThrow();
  });
  it("rejects unknown decimals, multiple matching transfers and self-funding", () => {
    expect(() => verifyCreatorReceipt(receipt(), signature, { ...route, decimals: 6 })).toThrow("decimals");
    const tx = receipt(); tx.transaction.message.instructions.push(tx.transaction.message.instructions[0]);
    expect(() => verifyCreatorReceipt(tx, signature, route)).toThrow("ambiguous");
    expect(() => verifyCreatorReceipt(receipt(), signature, { ...route, authority: route.recipient })).toThrow("self-transfer");
  });
  it("rejects fabricated balance increases and a substituted source owner", () => {
    const tx = receipt(); tx.meta!.postTokenBalances![1].uiTokenAmount.amount = "101";
    expect(() => verifyCreatorReceipt(tx, signature, route)).toThrow("destination delta");
    tx.meta!.postTokenBalances![1].uiTokenAmount.amount = "100"; tx.meta!.preTokenBalances![0].owner = "attacker";
    expect(() => verifyCreatorReceipt(tx, signature, route)).toThrow("identity");
  });
});
