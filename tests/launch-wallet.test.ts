import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { resolveLaunchWallet, type LaunchWalletBinding } from "@/lib/payout/launch-wallet";
import { createLaunchSigner } from "@/lib/payout/launch-signer";

const address = () => Keypair.generate().publicKey.toBase58();
function fixture() {
  // Synthetic local keys only. No mainnet signing or network requests.
  const main = Keypair.generate(), creator = Keypair.generate(), mint = address();
  const env = {
    NODE_ENV: "test" as const,
    TOPBLAST_TREASURY_ADDRESS: main.publicKey.toBase58(), TREASURY_PRIVATE_KEY: JSON.stringify([...main.secretKey]),
    TOPBLAST_CREATOR_ADDRESS: creator.publicKey.toBase58(), TOPBLAST_CREATOR_PRIVATE_KEY: JSON.stringify([...creator.secretKey]),
    TOPBLAST_TOKEN_MINT: mint,
  };
  const binding: LaunchWalletBinding = { launchId: "launch-a", mint, venue: "stonkfun", creator: env.TOPBLAST_CREATOR_ADDRESS, treasury: env.TOPBLAST_CREATOR_ADDRESS, rewardMint: address(), immutable: true };
  return { main, creator, env, binding };
}

describe("TOPBLAST-only creator signing", () => {
  it("selects the creator only for its exact immutable mint and funding address", () => {
    const { env, binding } = fixture();
    expect(resolveLaunchWallet(binding, env)).toEqual({ address: env.TOPBLAST_CREATOR_ADDRESS, role: "topblast_creator" });
    expect(createLaunchSigner(binding, env).publicKey()).toBe(env.TOPBLAST_CREATOR_ADDRESS);
  });
  it("preserves the platform source for other launches and existing funded configurations", () => {
    const { env, binding } = fixture();
    const other = { ...binding, mint: address(), creator: address(), treasury: env.TOPBLAST_TREASURY_ADDRESS };
    expect(createLaunchSigner(other, env).publicKey()).toBe(env.TOPBLAST_TREASURY_ADDRESS);
    expect(resolveLaunchWallet({ ...binding, treasury: env.TOPBLAST_TREASURY_ADDRESS }, env).role).toBe("platform_treasury");
  });
  it.each(["mint", "creator", "venue"] as const)("rejects a mismatched %s instead of using another launch's key", (field) => {
    const { env, binding } = fixture();
    expect(() => createLaunchSigner({ ...binding, [field]: field === "venue" ? "pumpfun" : address() }, env)).toThrow("restricted");
  });
  it("fails closed without the configured mint, creator key or matching public key", () => {
    const { env, binding } = fixture();
    expect(() => createLaunchSigner(binding, { ...env, TOPBLAST_TOKEN_MINT: "" })).toThrow("restricted");
    expect(() => createLaunchSigner(binding, { ...env, TOPBLAST_CREATOR_PRIVATE_KEY: "" })).toThrow("TOPBLAST_CREATOR_PRIVATE_KEY is missing");
    expect(() => createLaunchSigner(binding, { ...env, TOPBLAST_CREATOR_PRIVATE_KEY: env.TREASURY_PRIVATE_KEY })).toThrow("does not match");
    expect(() => createLaunchSigner(binding, { ...env, TOPBLAST_CREATOR_ADDRESS: "" })).toThrow("No authorized");
  });
  it("rejects mutable configurations, invalid mints and unknown funding wallets", () => {
    const { env, binding } = fixture();
    expect(() => resolveLaunchWallet({ ...binding, immutable: false }, env)).toThrow("immutable");
    expect(() => resolveLaunchWallet({ ...binding, mint: "TOPBLAST" }, env)).toThrow("verified mint");
    expect(() => resolveLaunchWallet({ ...binding, treasury: address() }, env)).toThrow("No authorized");
  });
  it("binds exact transaction bytes and reproduces the same signature on restart", () => {
    const { env, binding, creator } = fixture();
    const tx = new Transaction({ feePayer: creator.publicKey, recentBlockhash: "11111111111111111111111111111111" });
    tx.add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
    const request = { transactionBase64: tx.serialize({ requireAllSignatures: false }).toString("base64"), expectedPayer: binding.treasury, expectedMessageHash: createHash("sha256").update(tx.serializeMessage()).digest("hex") };
    expect(createLaunchSigner(binding, env).signTransaction(request)).toBe(createLaunchSigner(binding, env).signTransaction(request));
    expect(() => createLaunchSigner(binding, env).signTransaction({ ...request, expectedMessageHash: "0".repeat(64) })).toThrow("hash changed");
    expect(() => createLaunchSigner(binding, env).signTransaction({ ...request, expectedPayer: env.TOPBLAST_TREASURY_ADDRESS })).toThrow("reviewed payout summary");
  });
});
