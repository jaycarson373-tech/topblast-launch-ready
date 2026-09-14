export type EpochStep = "claim" | "swap" | "snapshot" | "allocate" | "payout" | "proof";

export interface EpochJob {
  id: string;
  launchId: string;
  rewardAssetMint: string;
  status: "pending" | "running" | "completed" | "failed";
  completedSteps: EpochStep[];
}

export interface EpochWorkerStore {
  lock(jobId: string): Promise<EpochJob | null>;
  hasIdempotencyKey(key: string): Promise<boolean>;
  recordStep(jobId: string, step: EpochStep, idempotencyKey: string, proof?: string): Promise<void>;
  fail(jobId: string, step: EpochStep, message: string): Promise<void>;
  complete(jobId: string): Promise<void>;
}

export interface EpochWorkerActions {
  claim(job: EpochJob): Promise<string | undefined>;
  swap(job: EpochJob): Promise<string | undefined>;
  snapshot(job: EpochJob): Promise<string | undefined>;
  allocate(job: EpochJob): Promise<string | undefined>;
  payout(job: EpochJob): Promise<string | undefined>;
  proof(job: EpochJob): Promise<string | undefined>;
}

const steps: EpochStep[] = ["claim", "swap", "snapshot", "allocate", "payout", "proof"];

export async function runEpochJob(jobId: string, store: EpochWorkerStore, actions: EpochWorkerActions): Promise<"locked" | "completed" | "failed"> {
  const job = await store.lock(jobId);
  if (!job) return "locked";
  for (const step of steps) {
    const key = `${job.launchId}:${job.id}:${step}`;
    if (job.completedSteps.includes(step) || await store.hasIdempotencyKey(key)) continue;
    try {
      const proof = await actions[step](job);
      await store.recordStep(job.id, step, key, proof);
    } catch (error) {
      await store.fail(job.id, step, error instanceof Error ? error.message : "Unknown worker error");
      return "failed";
    }
  }
  await store.complete(job.id);
  return "completed";
}
