import { createHash } from "node:crypto";
import BN from "bn.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { prepareStonkLaunch, recoverStonkLaunch, stonkPricingSchema, stonkRuleAllows, verifyStonkPricing, STONK_STANDARD_PLATFORM } from "@/lib/solana/stonk-launchlab";
import { LaunchpadConfig, PlatformConfig, PlatformCurveRule, getPdaLaunchpadConfigId, getPdaPlatformCurveRule } from "@/lib/solana/launchlab-sdk";
import { LAUNCHLAB_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "@/lib/solana/launchlab-constants";
import type { LaunchDraft } from "@/lib/types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), broadcast: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mocks.rpc }));
vi.mock("@/lib/db/server", () => ({ getAdminDb: () => ({ from: () => ({ insert: mocks.insert }) }) }));
vi.mock("@/lib/solana/checked-transfers", () => ({ broadcastSignedCheckedTransfer: mocks.broadcast }));
const address = () => Keypair.generate().publicKey.toBase58();
const genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const quoteMint = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const program = new PublicKey(LAUNCHLAB_PROGRAM), platform = new PublicKey(STONK_STANDARD_PLATFORM);
const config = getPdaLaunchpadConfigId(program, new PublicKey(quoteMint), 0, 0).publicKey;
const ruleAddress = getPdaPlatformCurveRule(program, platform, config).publicKey;
const pricing = () => stonkPricingSchema.parse({ quote: { mint: quoteMint, decimals: 9, tokenProgram: TOKEN_PROGRAM },
  raise: { raw: "25958591933081" }, prices: { observedAt: new Date().toISOString() },
  curve: { programId: LAUNCHLAB_PROGRAM, configId: config.toBase58(), curveType: "ConstantCurve", migrateType: "cpmm", baseDecimals: 6,
    supply: "1000000000000000", totalSellA: "793100000000000", cpmmCreatorFeeOn: 0, vesting: { totalLockedAmount: "0", cliffPeriod: "0", unlockPeriod: "0" } },
  platform: { standard: STONK_STANDARD_PLATFORM }, curveRule: { standard: ruleAddress.toBase58() }, modes: { standard: { transferFee: null } },
});
const draft = (): LaunchDraft => ({ venue: "stonkfun", creatorWallet: address(), launchMint: address(), name: "Stonk test", symbol: "TEST",
  description: "Fixture", logo: "data:image/png;base64,iVBORw0KGgo=", quoteMint, quoteSymbol: "STONK", feeTier: "1%",
  allocation: { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 } });
function ruleData() {
  const rule = PlatformCurveRule.decode(Buffer.alloc(150));
  rule.platformId = platform; rule.configId = config;
  // Exact important constraints observed on Stonk mainnet on 2026-09-21.
  rule.groups = [{ groupId: 0, epoch: new BN(1027), constraints: [
    { field: 9, op: 0, value: new BN(1) }, { field: 10, op: 0, value: new BN(0) },
    { field: 3, op: 0, value: new BN("1000000000000000") },
  ] }];
  return rule;
}
function account(bytes: Buffer, name: string) {
  createHash("sha256").update(`account:${name}`).digest().copy(bytes, 0, 0, 8);
  return { owner: LAUNCHLAB_PROGRAM, executable: false, data: [bytes.toString("base64"), "base64"] };
}
function accounts() {
  const configBytes = Buffer.alloc(LaunchpadConfig.span), platformBytes = Buffer.alloc(PlatformConfig.span), ruleBytes = Buffer.alloc(512), mint = Buffer.alloc(82);
  const configData = LaunchpadConfig.decode(configBytes); configData.mintB = new PublicKey(quoteMint); configData.minFundRaisingB = new BN(1);
  LaunchpadConfig.encode(configData, configBytes);
  const platformData = PlatformConfig.decode(platformBytes); platformData.restrictCurveParam = 1;
  PlatformConfig.encode(platformData, platformBytes); PlatformCurveRule.encode(ruleData(), ruleBytes);
  mint[44] = 9; mint[45] = 1;
  return [account(configBytes, "GlobalConfig"), account(platformBytes, "PlatformConfig"),
    { owner: TOKEN_PROGRAM, executable: false, data: [mint.toString("base64"), "base64"] }, account(ruleBytes, "PlatformCurveRule")];
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.insert.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (method: string) => {
    if (method === "getGenesisHash") return genesis;
    if (method === "getMultipleAccounts") return { value: accounts() };
    if (method === "getAccountInfo") return { value: null };
    if (method === "getLatestBlockhash") return { context: { slot: 100 }, value: { blockhash: address(), lastValidBlockHeight: 200 } };
    if (method === "getBalance") return { context: { slot: 100 }, value: 200_000_000 };
    if (method === "simulateTransaction") return { context: { slot: 100 }, value: { err: null, accounts: [{ lamports: 191_303_200 }] } };
    if (method === "getTransaction") return null;
    if (method === "getBlockHeight") return 100;
    if (method === "getSignatureStatuses") return { value: [null] };
    throw new Error(`Unexpected RPC ${method}`);
  });
});
const receipt = () => ({ signed_quote: JSON.stringify({ venue: "stonkfun", method: "launchlab", mint: address(), pool: address(), lastValidBlockHeight: 200 }), signed_payment_transaction: "original-signed-bytes" });

describe("Stonk's supported LaunchLab flow, simulated RPC only", () => {
  it("builds an unsigned two-signer Token-2022 launch on Stonk's platform with no tax", async () => {
    const input = draft(), verified = await verifyStonkPricing(pricing(), quoteMint);
    expect(verified.token2022).toBe(true);
    const prepared = await prepareStonkLaunch(input, verified);
    const tx = Transaction.from(Buffer.from(prepared.paymentTransaction, "base64"));
    expect(tx.signatures.map((item) => item.publicKey.toBase58())).toEqual([input.creatorWallet, input.launchMint]);
    expect(tx.signatures.every((item) => item.signature === null)).toBe(true);
    expect(tx.instructions).toHaveLength(2);
    expect(tx.instructions[1].programId.toBase58()).toBe(LAUNCHLAB_PROGRAM);
    expect(tx.instructions[1].keys[3].pubkey.toBase58()).toBe(STONK_STANDARD_PLATFORM);
    expect(tx.instructions[1].keys.at(-1)?.pubkey.toBase58()).toBe(ruleAddress.toBase58());
    expect(prepared.raw).toMatchObject({ baseTokenProgram: TOKEN_2022_PROGRAM, transferFeeEnabled: false, mintSignerRequired: true });
    expect(prepared.payment.lamports).toBe("8696800");
    expect(mocks.insert).toHaveBeenCalledOnce(); expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("getLatestBlockhash", [{ commitment: "confirmed" }]);
    expect(mocks.rpc).toHaveBeenCalledWith("simulateTransaction", [prepared.paymentTransaction, expect.objectContaining({ commitment: "confirmed", minContextSlot: 100 })]);
    expect(new Date(prepared.expiresAt!).getTime() - Date.now()).toBeLessThanOrEqual(30_000);
  });
  it("does not offer a stale blockhash after a slow simulation", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "getBlockHeight" ? 180 : original(...args));
    await expect(prepareStonkLaunch(draft(), await verifyStonkPricing(pricing(), quoteMint))).rejects.toThrow("took too long");
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("rejects stale pricing, substituted platforms and the wrong quote", async () => {
    const stale = pricing(); stale.prices.observedAt = new Date(Date.now() - 240_000).toISOString();
    await expect(verifyStonkPricing(stale, quoteMint)).rejects.toThrow("stale");
    await expect(verifyStonkPricing({ ...pricing(), platform: { standard: address() } }, quoteMint)).rejects.toThrow();
    await expect(verifyStonkPricing(pricing(), address())).rejects.toThrow("mint mismatch");
  });
  it("does not guess a token program or silently change parameters against an unknown rule", () => {
    const rule = ruleData();
    expect(stonkRuleAllows(pricing(), rule, false)).toBe(false);
    expect(stonkRuleAllows(pricing(), rule, true)).toBe(true);
    rule.groups[0].constraints.push({ field: 99, op: 0, value: new BN(0) });
    expect(stonkRuleAllows(pricing(), rule, true)).toBe(false);
  });
  it("rejects wrong config ownership and decimals", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    const rows = accounts(); rows[0].owner = TOKEN_PROGRAM;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "getMultipleAccounts" ? { value: rows } : original(...args));
    await expect(verifyStonkPricing(pricing(), quoteMint)).rejects.toThrow("Unverified");
    rows[0] = accounts()[0]; const mint = Buffer.from(rows[2].data[0], "base64"); mint[44] = 6; rows[2].data[0] = mint.toString("base64");
    await expect(verifyStonkPricing(pricing(), quoteMint)).rejects.toThrow("decimals");
  });
  it.each([{ err: "InsufficientFunds" }, {}])("does not persist a quote after unsuccessful/incomplete simulation: %j", async (value) => {
    const verified = await verifyStonkPricing(pricing(), quoteMint), original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "simulateTransaction" ? { context: { slot: 100 }, value } : original(...args));
    await expect(prepareStonkLaunch(draft(), verified)).rejects.toThrow("simulation failed");
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("recovers by rebroadcasting only the saved signed bytes, including after RPC timeout", async () => {
    mocks.broadcast.mockRejectedValue(new Error("timeout")); const saved = receipt();
    expect((await recoverStonkLaunch("sig", saved)).status).toBe("processing");
    expect((await recoverStonkLaunch("sig", saved)).status).toBe("processing");
    expect(mocks.broadcast.mock.calls).toEqual([["original-signed-bytes"], ["original-signed-bytes"]]);
  });
  it.each([null, { InstructionError: [1, "error"] }])("reports finalized success/failure without another broadcast: %j", async (err) => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "getTransaction" ? { slot: 150, meta: { err }, transaction: ["original-signed-bytes", "base64"] } : original(...args));
    expect((await recoverStonkLaunch("sig", receipt())).status).toBe(err === null ? "completed" : "failed");
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("rejects mismatched finalized bytes", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "getTransaction" ? { slot: 150, meta: { err: null }, transaction: ["another-launch", "base64"] } : original(...args));
    await expect(recoverStonkLaunch("sig", receipt())).rejects.toThrow("does not match");
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("never rebroadcasts an expired transaction and never falls back to the old fee endpoint", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => args[0] === "getBlockHeight" ? 201 : original(...args));
    expect((await recoverStonkLaunch("sig", receipt())).status).toBe("failed");
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
