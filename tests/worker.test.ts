import { describe, expect, it, vi } from "vitest";
import { runEpochJob, type EpochJob, type EpochStep, type EpochWorkerStore } from "@/lib/rewards/worker";

function memoryStore(job: EpochJob) {
  const keys = new Set<string>();
  const completed: EpochStep[] = [...job.completedSteps];
  const store: EpochWorkerStore = {
    lock: vi.fn(async () => ({ ...job, completedSteps: [...completed] })),
    hasIdempotencyKey: vi.fn(async (key) => keys.has(key)),
    recordStep: vi.fn(async (_id, step, key) => { keys.add(key); completed.push(step); }),
    fail: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
  };
  return { store, keys };
}

const actions = () => ({ claim: vi.fn(async () => "claim-sig"), swap: vi.fn(async () => "swap-sig"), snapshot: vi.fn(async () => "snapshot"), allocate: vi.fn(async () => "allocation"), payout: vi.fn(async () => "payout-sig"), proof: vi.fn(async () => "proof") });

describe("reward worker idempotency", () => {
  it("does not repeat completed work after a restart", async () => {
    const job: EpochJob = { id: "epoch", launchId: "launch", rewardAssetMint: "STONK", status: "pending", completedSteps: [] };
    const { store } = memoryStore(job);
    const first = actions();
    await runEpochJob(job.id, store, first);
    const second = actions();
    await runEpochJob(job.id, store, second);
    expect(second.payout).not.toHaveBeenCalled();
    expect(second.claim).not.toHaveBeenCalled();
  });

  it.each(["swap", "payout"] as const)("records a failed %s and stops", async (failedStep) => {
    const job: EpochJob = { id: "epoch", launchId: "launch", rewardAssetMint: "STONK", status: "pending", completedSteps: [] };
    const { store } = memoryStore(job);
    const actionSet = actions();
    actionSet[failedStep].mockRejectedValueOnce(new Error(`${failedStep} unavailable`));
    expect(await runEpochJob(job.id, store, actionSet)).toBe("failed");
    expect(store.fail).toHaveBeenCalledWith("epoch", failedStep, `${failedStep} unavailable`);
  });
});
