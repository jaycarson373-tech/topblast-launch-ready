import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import recordedBuy from "./fixtures/pump-mainnet-buy.json";
import { activityOrdinal } from "@/lib/worker/pipeline";
import { buildEpochPlan } from "@/lib/rewards/epoch";
import { emptyPosition } from "@/lib/rewards/position";
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_EVENT_AUTHORITY_PDA, GLOBAL_PDA, creatorVaultPda, feeSharingConfigPda, pumpIdl, type DistributeCreatorFeesEvent, type TradeEventBc } from "@/lib/solana/pump-sdk";
import { decodeFinalizedPumpTransaction } from "@/lib/indexer/pumpfun-decoder";
import { verifyPumpFeeDistribution } from "@/lib/funding/pump-auto";
import { validatePumpImage } from "@/lib/venue/pumpfun-adapter";
import { inspectSignedMessage } from "@/lib/solana/signed-message";
import { createHash } from "node:crypto";
import type { FinalizedBlockTransaction, LaunchLabDecoderMarket } from "@/lib/indexer/launchlab-decoder";

vi.mock("@/lib/db/server", () => ({ getAdminDb: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const key = () => Keypair.generate().publicKey.toBase58();
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes: number[]) { let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`), out = ""; while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; } return out; }
function fixture(buy = true) {
  const user = key(), creator = key(), mint = key(), pool = key(), vault = key(), userToken = key();
  const market: LaunchLabDecoderMarket = { launchId: "launch-a", marketAddress: pool, baseMint: mint, quoteMint: "So11111111111111111111111111111111111111112", authorityAddress: pool, configAddress: GLOBAL_PDA.toBase58(), platformConfigAddress: GLOBAL_PDA.toBase58(), baseVault: vault, quoteVault: pool, baseTokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(), quoteTokenProgram: key(), creatorAddress: creator };
  const accounts = [GLOBAL_PDA.toBase58(), key(), mint, pool, vault, userToken, user, SystemProgram.programId.toBase58()];
  accounts.push(...(buy ? [market.baseTokenProgram, creatorVaultPda(new PublicKey(creator)).toBase58()] : [creatorVaultPda(new PublicKey(creator)).toBase58(), market.baseTokenProgram]), PUMP_EVENT_AUTHORITY_PDA.toBase58(), PUMP_PROGRAM_ID.toBase58());
  const balance = (accountIndex: number, owner: string, amount: number) => ({ accountIndex, owner, mint, programId: market.baseTokenProgram, uiTokenAmount: { amount: String(amount) } });
  const tx: FinalizedBlockTransaction = {
    transaction: { signatures: ["signature"], message: { accountKeys: [{ pubkey: user, signer: true }, pool, vault, userToken], instructions: [{ programId: PUMP_PROGRAM_ID.toBase58(), accounts, data: b58(buy ? [102,6,61,18,1,218,235,234] : [51,230,133,164,1,127,131,173]) }] } },
    meta: { err: null, preTokenBalances: [balance(2, pool, buy ? 1000 : 900), balance(3, user, buy ? 0 : 100)], postTokenBalances: [balance(2, pool, buy ? 900 : 1000), balance(3, user, buy ? 100 : 0)], innerInstructions: [{ index: 0, instructions: [
      { stackHeight: 2, programId: SystemProgram.programId.toBase58(), parsed: { type: "transfer", info: { source: user, destination: pool, lamports: 500 } } },
      { stackHeight: 2, programId: market.baseTokenProgram, parsed: { type: "transferChecked", info: { source: buy ? vault : userToken, destination: buy ? userToken : vault, tokenAmount: { amount: "100" } } } },
      { stackHeight: 2, programId: PUMP_PROGRAM_ID.toBase58(), accounts: [PUMP_EVENT_AUTHORITY_PDA.toBase58()], data: b58([228,69,165,46,81,203,154,29,189,219,127,211,78,230,97,238,0]) },
    ] }] },
  };
  const amount = (n: number) => ({ toString: () => String(n), isZero: () => n === 0 });
  vi.spyOn(PUMP_SDK, "decodeTradeEventBc").mockReturnValue({ mint: new PublicKey(mint), user: new PublicKey(user), creator: new PublicKey(creator), quoteMint: PublicKey.default, isBuy: buy, tokenAmount: amount(100), solAmount: amount(500), quoteAmount: amount(0), holderRewards: amount(0), mayhemMode: false } as unknown as TradeEventBc);
  return { tx, market, user };
}
describe("Pump.fun verified trade boundary", () => {
  it("decodes a real finalized mainnet buy with the official event decoder", () => {
    const mint = "EfkgeQ8azEME36C6dgoQRG1qjfn7AEUvpLwmp4Acpump", pool = "vDVbCoddXpqDLyiy4TW9vyBndcT5ResBaJZK1ZGhXrt";
    const market: LaunchLabDecoderMarket = { launchId: "recorded", baseMint: mint, marketAddress: pool, authorityAddress: pool, creatorAddress: "Aa1Ay4DYPCafTXNdhvkJoPGWu7HDajCz5fpsAWoGKXCz", quoteMint: "So11111111111111111111111111111111111111112", quoteVault: pool, baseVault: getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(pool), true, TOKEN_2022_PROGRAM_ID).toBase58(), baseTokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(), quoteTokenProgram: TOKEN_PROGRAM_ID.toBase58(), configAddress: GLOBAL_PDA.toBase58(), platformConfigAddress: GLOBAL_PDA.toBase58() };
    const result = decodeFinalizedPumpTransaction(recordedBuy as FinalizedBlockTransaction, market, BigInt(recordedBuy.slot));
    expect(result.events).toEqual([{ kind: "verified_buy", launchId: "recorded", wallet: "B2SCm5F5rPP1UDCsrzdhnZuQw3VeCi9Yt3MynB8UaysV", tokenRaw: 1659720167215n, quoteAtoms: 159671510n, slot: 447237789n }]);
  });
  it("recognizes an exact buy only after market, event, token and SOL movement checks", () => {
    const { tx, market, user } = fixture();
    expect(decodeFinalizedPumpTransaction(tx, market, 100n).events).toEqual([{ kind: "verified_buy", launchId: "launch-a", wallet: user, tokenRaw: 100n, quoteAtoms: 500n, slot: 100n }]);
  });
  it("retains pre-sharing buys and verifies post-sharing buys against the same mint", () => {
    const { tx, market } = fixture();
    expect(decodeFinalizedPumpTransaction(tx, market, 100n).events).toHaveLength(1);
    const event = PUMP_SDK.decodeTradeEventBc(Buffer.alloc(0));
    const sharing = feeSharingConfigPda(new PublicKey(market.baseMint));
    tx.transaction.message.instructions[0].accounts![9] = creatorVaultPda(sharing).toBase58();
    vi.mocked(PUMP_SDK.decodeTradeEventBc).mockReturnValue({ ...event, creator: sharing });
    expect(decodeFinalizedPumpTransaction(tx, market, 110n).events).toHaveLength(1);
    vi.mocked(PUMP_SDK.decodeTradeEventBc).mockReturnValue(event);
    expect(() => decodeFinalizedPumpTransaction(tx, market, 110n)).toThrow("event identity");
    tx.transaction.message.instructions[0].accounts![9] = creatorVaultPda(feeSharingConfigPda(new PublicKey(key()))).toBase58();
    expect(() => decodeFinalizedPumpTransaction(tx, market, 110n)).toThrow("market identity");
  });
  it("keeps the same wallet and another mint isolated", () => {
    const { tx, market } = fixture();
    expect(decodeFinalizedPumpTransaction(tx, { ...market, launchId: "launch-b", baseMint: key(), marketAddress: key() }, 100n).events).toEqual([]);
  });
  it("records sells and skips failed transactions", () => {
    const { tx, market } = fixture(false);
    expect(decodeFinalizedPumpTransaction(tx, market, 100n).events[0].kind).toBe("sell");
    tx.meta!.err = { InstructionError: [0, "failed"] };
    expect(decodeFinalizedPumpTransaction(tx, market, 100n).events).toEqual([]);
  });
  it("rejects quote tampering and unverified pool identities", () => {
    const { tx, market } = fixture();
    tx.meta!.innerInstructions![0].instructions[0].parsed!.info!.lamports = 501;
    expect(() => decodeFinalizedPumpTransaction(tx, market, 100n)).toThrow("quote amount");
    expect(() => decodeFinalizedPumpTransaction(tx, { ...market, marketAddress: key() }, 100n)).toThrow("market identity");
  });
  it("treats ordinary transfers as zero-basis arrivals and outgoing exclusions", () => {
    const { tx, market, user } = fixture();
    const from = key();
    tx.transaction.message.instructions = [];
    tx.meta!.preTokenBalances![0].owner = from; tx.meta!.postTokenBalances![0].owner = from;
    tx.transaction.message.instructions.push(tx.meta!.innerInstructions![0].instructions[1]); tx.meta!.innerInstructions = [];
    const events = decodeFinalizedPumpTransaction(tx, market, 100n).events;
    expect(events.map((event) => event.kind)).toEqual(["outgoing_transfer", "incoming_transfer"]);
    expect(events[1].wallet).toBe(user); expect(events[1]).not.toHaveProperty("quoteAtoms");
  });
  it("rejects unsupported balance changes instead of inventing basis", () => {
    const { tx, market } = fixture(); tx.meta!.postTokenBalances![1].uiTokenAmount.amount = "101";
    expect(() => decodeFinalizedPumpTransaction(tx, market, 100n)).toThrow("finalized balances");
  });
});
describe("finalized snapshot boundaries", () => {
  it("keeps initial pool minting separate from an atomic Pump dev-buy basis", () => {
    const { tx, market } = fixture();
    const poolBalance = tx.meta!.preTokenBalances!.find(b => b.owner === market.marketAddress)!;
    const supply = poolBalance.uiTokenAmount.amount;
    tx.meta!.preTokenBalances = tx.meta!.preTokenBalances!.filter(b => b !== poolBalance);
    tx.meta!.innerInstructions![0].instructions.unshift({ programId: market.baseTokenProgram, stackHeight: 2, parsed: { type: "mintTo", info: { mint: market.baseMint, account: market.baseVault, amount: supply } } });
    const events = decodeFinalizedPumpTransaction(tx, market, 100n).events;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("verified_buy");
    tx.meta!.innerInstructions![0].instructions[0].parsed!.info!.mint = key();
    expect(() => decodeFinalizedPumpTransaction(tx, market, 100n)).toThrow();
  });
  it("preserves transaction order ahead of individual event indexes", () => {
    expect(activityOrdinal(2, 0)).toBeGreaterThan(activityOrdinal(1, 65535));
    expect(() => activityOrdinal(32768, 0)).toThrow();
  });
  it("rejects future activity in an older epoch snapshot", () => {
    expect(() => buildEpochPlan({ launchId: "a", epochId: "e", startSlot: 1n, snapshotSlot: 10n, fundedBudgetQuoteAtoms: 100n, currentPriceQuoteAtomsPerToken: 1n, tokenDecimals: 6, positions: [{ ...emptyPosition("a", "wallet"), lastActivitySlot: 11n }] })).toThrow("after the finalized snapshot");
  });
});
describe("Pump.fun signing and metadata", () => {
  it("requires both wallet and mint signatures and binds immutable message bytes", () => {
    const payer = Keypair.generate(), mint = Keypair.generate();
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: key() }).add(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId }));
    const expectedMessageHash = createHash("sha256").update(tx.serializeMessage()).digest("hex");
    tx.partialSign(mint);
    const input = { expectedMessageHash, expectedPayer: payer.publicKey.toBase58(), signedTransaction: tx.serialize({ requireAllSignatures: false }).toString("base64") };
    expect(() => inspectSignedMessage(input)).toThrow("signature");
    tx.partialSign(payer); input.signedTransaction = tx.serialize().toString("base64");
    expect(inspectSignedMessage(input).signature).toBeTruthy();
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mint.publicKey, lamports: 1 })); tx.sign(payer, mint);
    expect(() => inspectSignedMessage({ ...input, signedTransaction: tx.serialize().toString("base64") })).toThrow("instructions");
  });
  it("rejects SVG, fake MIME types and malformed image data", () => {
    expect(() => validatePumpImage("data:image/svg+xml;base64,AA==")).toThrow();
    expect(() => validatePumpImage("data:image/png;base64,PHNjcmlwdD4=")).toThrow();
    expect(validatePumpImage(`data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")}`).contentType).toBe("image/png");
  });
});

describe("Pump.fun per-mint fee receipts", () => {
  it("accepts only the exact mint, sharing config, treasury and measured SOL delta", () => {
    const mint = Keypair.generate().publicKey, treasury = Keypair.generate().publicKey, sharing = feeSharingConfigPda(mint), bondingCurve = Keypair.generate().publicKey;
    const discriminator = (pumpIdl.events as Array<{ name: string; discriminator: number[] }>).find((event) => event.name.toLowerCase() === "distributecreatorfeesevent")!.discriminator;
    const instruction = { programId: PUMP_PROGRAM_ID.toBase58(), data: b58([228,69,165,46,81,203,154,29,...discriminator,0]) };
    vi.spyOn(PUMP_SDK, "decodeDistributeCreatorFeesEvent").mockReturnValue({
      mint, bondingCurve, sharingConfig: sharing, admin: treasury, quoteMint: PublicKey.default,
      shareholders: [{ address: treasury, shareBps: 10_000 }], distributed: { toString: () => "100" },
    } as unknown as DistributeCreatorFeesEvent);
    const market = { launch_id: "launch-a", launch_slot: 1, last_indexed_slot: 100, market_address: bondingCurve.toBase58(), base_mint: mint.toBase58(), quote_mint: "So11111111111111111111111111111111111111112", quote_token_program: TOKEN_PROGRAM_ID.toBase58(), creator_address: sharing.toBase58() };
    const tx = { slot: 50, blockTime: 1790078400, meta: { err: null, fee: 10, preBalances: [1000], postBalances: [1090], innerInstructions: [{ instructions: [instruction] }] }, transaction: { signatures: ["receipt"], message: { accountKeys: [treasury.toBase58()], instructions: [] } } };
    expect(verifyPumpFeeDistribution(tx, "receipt", market, treasury, sharing)).toMatchObject({ amountAtoms: "100", quoteMint: market.quote_mint, sharingConfig: sharing.toBase58() });
    tx.meta.postBalances[0] = 1089;
    expect(() => verifyPumpFeeDistribution(tx, "receipt", market, treasury, sharing)).toThrow("destination delta");
    tx.meta.postBalances[0] = 990;
    vi.mocked(PUMP_SDK.decodeDistributeCreatorFeesEvent).mockReturnValue({ mint, bondingCurve, sharingConfig: sharing, admin: treasury, quoteMint: PublicKey.default, shareholders: [{ address: treasury, shareBps: 10_000 }], distributed: { toString: () => "0" } } as unknown as DistributeCreatorFeesEvent);
    expect(verifyPumpFeeDistribution(tx, "receipt", market, treasury, sharing)).toMatchObject({ amountAtoms: "0" });
    expect(() => verifyPumpFeeDistribution(tx, "receipt", { ...market, market_address: key() }, treasury, sharing)).toThrow("identity mismatch");
    expect(() => verifyPumpFeeDistribution(tx, "receipt", { ...market, base_mint: key() }, treasury, sharing)).toThrow("identity mismatch");
    expect(() => verifyPumpFeeDistribution(tx, "receipt", { ...market, launch_slot: 51 }, treasury, sharing)).toThrow("finalized proof");
    expect(() => verifyPumpFeeDistribution({ ...tx, meta: { ...tx.meta, err: undefined } }, "receipt", market, treasury, sharing)).toThrow("finalized proof");
  });
});
