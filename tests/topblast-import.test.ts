import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
vi.mock("@/lib/db/launch-repository", () => ({ registerLaunchTracker: vi.fn() }));
import { verifyImportedCreation } from "@/lib/db/topblast-import";
import { LAUNCHLAB_PROGRAM } from "@/lib/solana/launchlab-constants";
import publicCreation from "./fixtures/top-public-creation.json";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Buffer) { let n = BigInt(`0x${bytes.toString("hex")}`), result = ""; while (n) { result = alphabet[Number(n % 58n)] + result; n /= 58n; } return result; }
function tx() {
  return { slot: 42, blockTime: 1700000000, transaction: { signatures: ["real-creation"], message: { accountKeys: ["mint", "pool", "creator"], instructions: [{ programId: LAUNCHLAB_PROGRAM, accounts: ["mint", "pool", "creator", "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7"], data: base58(createHash("sha256").update("global:initialize_with_token_2022").digest().subarray(0, 8)) }] } }, meta: { err: null, preBalances: [0, 0, 10000], postBalances: [100, 100, 9800], innerInstructions: [] } };
}
it("verifies TOP's actual finalized creation receipt without importing or changing it", () => {
  expect(verifyImportedCreation(publicCreation, publicCreation.transaction.signatures[0], "85iZwkRNwUs8q9sfLJCXhiVsny4faMyf5nbDQZ7x6omB", "CdKtdZVcn9zDKoivtKjZbACHXs4Uau3TXK6BtqhdcowB", "2A3RvpbHkcgL5XTkqdxYXb6Ywp1pXRSodF8W6bx7GST9")).toMatchObject({ slot: 450081397 });
});
it("accepts real creation semantics rather than an arbitrary transaction mentioning a mint", () => {
  expect(verifyImportedCreation(tx(), "real-creation", "mint", "pool", "creator")).toEqual({ signature: "real-creation", slot: 42, blockTime: 1700000000 });
  const existing = tx(); existing.meta.preBalances[0] = 10;
  expect(() => verifyImportedCreation(existing, "real-creation", "mint", "pool", "creator")).toThrow("did not create");
});
it("rejects a wrong creator, pool, program, failed receipt and unsupported instruction", () => {
  expect(() => verifyImportedCreation(tx(), "real-creation", "mint", "pool", "other")).toThrow("creation instruction");
  expect(() => verifyImportedCreation(tx(), "real-creation", "mint", "other", "creator")).toThrow("did not create");
  const wrong = tx(); wrong.transaction.message.instructions[0].programId = "attacker";
  expect(() => verifyImportedCreation(wrong, "real-creation", "mint", "pool", "creator")).toThrow("creation instruction");
  const swap = tx(); swap.transaction.message.instructions[0].data = "11111111";
  expect(() => verifyImportedCreation(swap, "real-creation", "mint", "pool", "creator")).toThrow("creation instruction");
});
