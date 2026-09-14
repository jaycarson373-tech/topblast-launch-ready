import { describe, expect, it } from "vitest";
import { decodeFinalizedLaunchLabTransaction, type FinalizedBlockTransaction, type LaunchLabDecoderMarket } from "@/lib/indexer/launchlab-decoder";

const launchlab = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const token22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const payer = "payer", authority = "authority", baseUser = "base-user", quoteUser = "quote-user";
const market: LaunchLabDecoderMarket = { launchId: "launch-a", marketAddress: "pool", baseMint: "base", quoteMint: "quote", authorityAddress: authority, configAddress: "config", platformConfigAddress: "platform", baseVault: "base-vault", quoteVault: "quote-vault", baseTokenProgram: token22, quoteTokenProgram: token, creatorAddress: "creator" };
const balance = (accountIndex: number, mint: string, owner: string, programId: string, amount: string) => ({ accountIndex, mint, owner, programId, uiTokenAmount: { amount } });
function buy(): FinalizedBlockTransaction {
  const keys = [{ pubkey: payer, signer: true }, "base-vault", baseUser, quoteUser, "quote-vault", "pool"];
  return {
    transaction: { signatures: ["sig"], message: { accountKeys: keys, instructions: [{ programId: launchlab, data: "HtTvTxyWwMDQqs3U5RkTxH2CAxBkUo1uCR9wGbvxWjgj", accounts: [payer, authority, "config", "platform", "pool", baseUser, quoteUser, "base-vault", "quote-vault", "base", "quote", token22, token, "event", launchlab] }] } },
    meta: { err: null,
      preTokenBalances: [balance(1, "base", authority, token22, "1000"), balance(2, "base", payer, token22, "0"), balance(3, "quote", payer, token, "100"), balance(4, "quote", authority, token, "1000")],
      postTokenBalances: [balance(1, "base", authority, token22, "950"), balance(2, "base", payer, token22, "50"), balance(3, "quote", payer, token, "0"), balance(4, "quote", authority, token, "1100")],
      innerInstructions: [{ index: 0, instructions: [
        { programId: token, stackHeight: 2, parsed: { type: "transferChecked", info: { source: quoteUser, destination: "quote-vault", tokenAmount: { amount: "100" } } } },
        { programId: token22, stackHeight: 2, parsed: { type: "transferChecked", info: { source: "base-vault", destination: baseUser, tokenAmount: { amount: "50" } } } },
      ] }],
    },
  };
}

describe("finalized LaunchLab decoder", () => {
  it("establishes exact basis only for a validated pool buy", () => {
    expect(decodeFinalizedLaunchLabTransaction(buy(), market, 50n).events).toEqual([{ kind: "verified_buy", launchId: "launch-a", wallet: payer, tokenRaw: 50n, quoteAtoms: 100n, slot: 50n }]);
  });
  it("fails closed when the registered vault identity differs", () => {
    expect(() => decodeFinalizedLaunchLabTransaction(buy(), { ...market, quoteVault: "other" }, 50n)).toThrow("identity");
  });
  it("records ordinary transfers without fabricating basis", () => {
    const tx: FinalizedBlockTransaction = { transaction: { signatures: ["transfer"], message: { accountKeys: ["source", "destination"], instructions: [{ programId: token22, parsed: { type: "transfer", info: { source: "source", destination: "destination", amount: "7" } } }] } }, meta: { err: null, preTokenBalances: [balance(0, "base", "alice", token22, "10"), balance(1, "base", "bob", token22, "0")], postTokenBalances: [balance(0, "base", "alice", token22, "3"), balance(1, "base", "bob", token22, "7")] } };
    expect(decodeFinalizedLaunchLabTransaction(tx, market, 51n).events.map((event) => event.kind)).toEqual(["outgoing_transfer", "incoming_transfer"]);
  });
});
