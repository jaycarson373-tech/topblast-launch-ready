import { describe, expect, it } from "vitest";
import { advanceRehearsal, newRehearsal, rehearsalPlan, rehearsalSchema, runRehearsal } from "@/lib/testing/rehearsal";

describe("public rehearsal (simulation, not onchain acceptance)", () => {
  it("reuses weighted entry and leaves transfer-only wallets without basis", () => {
    const plan = rehearsalPlan(newRehearsal());
    expect(plan.snapshots[0].averageEntryQuoteAtoms).toBe(1500n);
    expect(plan.snapshots[2].averageEntryQuoteAtoms).toBe(0n);
    expect(plan.snapshots[2].status).toBe("NOT_A_VERIFIED_BUYER");
  });
  it("does not fund a launch before the funding stage", () => {
    expect(rehearsalPlan(newRehearsal()).fundedBudgetQuoteAtoms).toBe(0n);
  });
  it("splits sample fees and reserves only the reward portion", () => {
    const plan = rehearsalPlan({ ...newRehearsal(), step: 3 });
    expect(plan.split).toEqual({ topblast: 7000n, creator: 2000n, protocol: 1000n });
    expect(plan.reserved).toBe(7000n);
    expect(plan.paid).toBe(0n);
    expect(plan.available).toBe(0n);
  });
  it("keeps the same sample holders in an unfunded second launch unpaid", () => {
    const state = runRehearsal(newRehearsal());
    expect(rehearsalPlan(state).paid).toBe(7000n);
    expect(rehearsalPlan(state, "SIM-B").paid).toBe(0n);
    expect(rehearsalPlan(state, "SIM-B").allocations).toEqual([]);
  });
  it.each([["sell", "SOLD_THIS_EPOCH"], ["outgoing_transfer", "TRANSFERRED"]] as const)("excludes %s this epoch", (movement, status) => {
    const plan = rehearsalPlan(runRehearsal({ ...newRehearsal(), movement }));
    expect(plan.snapshots[0].status).toBe(status);
    expect(plan.allocations.some((item) => item.wallet === "Holder A")).toBe(false);
  });
  it("incoming units do not dilute or increase purchased basis", () => {
    const plan = rehearsalPlan({ ...newRehearsal(), movement: "incoming_transfer" });
    expect(plan.snapshots[0].averageEntryQuoteAtoms).toBe(1500n);
    expect(plan.snapshots[0].eligibleUnitsRaw).toBe(20n);
  });
  it.each([{ gross: 0 }, { price: 30 }])("leaves funds unallocated when ineligible or unfunded: %j", (change) => {
    const plan = rehearsalPlan(runRehearsal({ ...newRehearsal(), ...change }));
    expect(plan.paid).toBe(0n);
    expect(plan.reserved).toBe(0n);
    expect(plan.available).toBe(plan.fundedBudgetQuoteAtoms);
  });
  it("restores a partial simulated payout and acknowledges keys once", () => {
    let state = { ...newRehearsal(), step: 3 };
    state = advanceRehearsal(state);
    expect(state.step).toBe(4);
    expect(state.paidKeys).toHaveLength(1);
    expect(rehearsalPlan(state).reserved).toBeGreaterThan(0n);
    state = rehearsalSchema.parse(JSON.parse(JSON.stringify(state)));
    state = advanceRehearsal(state);
    const completed = rehearsalPlan(state);
    expect(completed.reserved).toBe(0n);
    for (let i = 0; i < 5; i++) state = advanceRehearsal(state);
    expect(state.paidKeys).toHaveLength(2);
    expect(rehearsalPlan(state).paid).toBe(completed.paid);
  });
  it("rejects malformed saved scenarios without accepting production receipts", () => {
    expect(rehearsalSchema.safeParse({ ...newRehearsal(), gross: -1 }).success).toBe(false);
    expect(rehearsalSchema.safeParse({ launchId: "production", paymentSignature: "anything" }).success).toBe(false);
  });
});
