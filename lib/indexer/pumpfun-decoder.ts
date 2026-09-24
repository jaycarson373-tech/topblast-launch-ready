import { pumpIdl, PUMP_SDK, PUMP_PROGRAM_ID, PUMP_EVENT_AUTHORITY_PDA, GLOBAL_PDA, creatorVaultPda, feeSharingConfigPda, type TradeEventBc } from "@/lib/solana/pump-sdk";
import { PublicKey } from "@solana/web3.js";
import { PUMP_SOL_MINT } from "@/lib/solana/pumpfun";
import { decode58, type FinalizedBlockTransaction, type LaunchLabDecoderMarket } from "./launchlab-decoder";
import type { PositionEvent } from "@/lib/rewards/position";

type Ix = FinalizedBlockTransaction["transaction"]["message"]["instructions"][number];
type Movement = { source: string; destination: string; amount: bigint; order: number; swap: Swap | null };
type Swap = { user: string; userToken: string; userQuoteToken?: string; creator: string; buy: boolean; event?: TradeEventBc; quoteIn: bigint; depth: number };
const swapNames = new Set(["buy", "buy_exact_sol_in", "buy_v2", "buy_exact_quote_in_v2", "sell", "sell_v2"]);
const definitions = pumpIdl.instructions.filter((ix) => swapNames.has(ix.name));
const eventTag = Buffer.from([189,219,127,211,78,230,97,238]);
const cpiTag = Buffer.from([228,69,165,46,81,203,154,29]);

export function decodeFinalizedPumpTransaction(tx: FinalizedBlockTransaction, market: LaunchLabDecoderMarket, slot: bigint) {
  const signature = tx.transaction.signatures[0];
  if (!signature || !tx.meta) throw new Error("Missing finalized Pump.fun transaction metadata");
  if (tx.meta.err) return { signature, events: [] as PositionEvent[] };
  const keys = tx.transaction.message.accountKeys.map((item) => typeof item === "string" ? item : item.pubkey);
  const allBalances = [...tx.meta.preTokenBalances ?? [], ...tx.meta.postTokenBalances ?? []];
  if (!allBalances.some((item) => item.mint === market.baseMint) && !keys.includes(market.marketAddress)) return { signature, events: [] as PositionEvent[] };
  const signers = new Set(tx.transaction.message.accountKeys.flatMap((item) => typeof item !== "string" && item.signer ? [item.pubkey] : []));
  const balances = new Map<string, { owner: string; pre: bigint; post: bigint }>();
  for (const phase of ["pre", "post"] as const) for (const row of tx.meta[phase === "pre" ? "preTokenBalances" : "postTokenBalances"] ?? []) {
    if (row.mint !== market.baseMint) continue;
    const address = keys[row.accountIndex];
    if (!address || !row.owner || row.programId !== market.baseTokenProgram || !/^\d+$/.test(row.uiTokenAmount.amount)) throw new Error("Unverified Pump.fun token balance");
    const previous = balances.get(address);
    if (previous && previous.owner !== row.owner) throw new Error("Token ownership changed within transaction");
    balances.set(address, { owner: row.owner, pre: previous?.pre ?? 0n, post: previous?.post ?? 0n, [phase]: BigInt(row.uiTokenAmount.amount) });
  }
  const swaps: Swap[] = [], movements: Movement[] = [];
  // The original creator remains immutable in the ledger. Pump can move fees
  // to this mint's deterministic sharing PDA without invalidating earlier buys.
  const creators = [market.creatorAddress, feeSharingConfigPda(new PublicKey(market.baseMint)).toBase58()];
  function visit(ix: Ix, inherited: Swap | null, depth: number): Swap | null {
    let active = inherited;
    if (ix.programId === PUMP_PROGRAM_ID.toBase58() && ix.data) {
      const bytes = decode58(ix.data);
      const definition = definitions.find((row) => Buffer.from(row.discriminator).equals(bytes.subarray(0, 8)));
      if (definition) {
        const account = Object.fromEntries(definition.accounts.map((row, index) => [row.name, ix.accounts?.[index]]));
        if ((account.base_mint ?? account.mint) !== market.baseMint) return null;
        const creator = creators.find(address => account.creator_vault === creatorVaultPda(new PublicKey(address)).toBase58());
        if (!creator || account.bonding_curve !== market.marketAddress || (account.associated_base_bonding_curve ?? account.associated_bonding_curve) !== market.baseVault || (account.base_token_program ?? account.token_program) !== market.baseTokenProgram || account.global !== GLOBAL_PDA.toBase58() || account.program !== PUMP_PROGRAM_ID.toBase58() || account.event_authority !== PUMP_EVENT_AUTHORITY_PDA.toBase58()) throw new Error("Pump.fun swap market identity mismatch");
        if (account.quote_mint && account.quote_mint !== market.quoteMint) throw new Error("Pump.fun swap quote mismatch");
        if (account.quote_token_program && account.quote_token_program !== market.quoteTokenProgram) throw new Error("Pump.fun swap quote program mismatch");
        if (market.quoteMint !== PUMP_SOL_MINT && account.associated_quote_bonding_curve !== market.quoteVault) throw new Error("Pump.fun swap quote vault mismatch");
        if (!account.user || !signers.has(account.user)) throw new Error("Pump.fun buyer is not a verified signer");
        const userToken = account.associated_base_user ?? account.associated_user;
        if (!userToken || balances.get(userToken)?.owner !== account.user) throw new Error("Pump.fun user token account mismatch");
        active = { user: account.user, userToken, creator, userQuoteToken: account.associated_quote_user, buy: definition.name.startsWith("buy"), quoteIn: 0n, depth };
        swaps.push(active);
      } else if (bytes.subarray(0, 8).equals(cpiTag) && bytes.subarray(8, 16).equals(eventTag)) {
        if (!active || depth !== active.depth + 1 || ix.accounts?.[0] !== PUMP_EVENT_AUTHORITY_PDA.toBase58()) throw new Error("Unattributed Pump.fun event");
        if (active.event) throw new Error("Duplicate Pump.fun trade event within swap");
        const event = PUMP_SDK.decodeTradeEventBc(bytes.subarray(16));
        if (event.mint.toBase58() !== market.baseMint || event.user.toBase58() !== active.user || event.isBuy !== active.buy || event.creator.toBase58() !== active.creator || event.mayhemMode || !event.holderRewards.isZero()) throw new Error("Pump.fun trade event identity mismatch");
        const eventQuote = event.quoteMint.equals(PublicKey.default) ? PUMP_SOL_MINT : event.quoteMint.toBase58();
        if (eventQuote !== market.quoteMint) throw new Error("Pump.fun event quote mismatch");
        active.event = event;
      }
    }
    const info = ix.parsed?.info;
    if (active && ix.programId === "11111111111111111111111111111111" && ix.parsed?.type === "transfer" && info?.source === active.user && info.destination === market.marketAddress) {
      if (!Number.isSafeInteger(info.lamports) || Number(info.lamports) <= 0) throw new Error("Inexact Pump.fun SOL transfer");
      active.quoteIn += BigInt(Number(info.lamports));
    }
    if (active?.buy && market.quoteMint !== PUMP_SOL_MINT && ix.programId === market.quoteTokenProgram && ["transfer", "transferChecked"].includes(ix.parsed?.type ?? "") && info && info.source === active.userQuoteToken) {
      const raw = info.amount ?? (info.tokenAmount as { amount?: string } | undefined)?.amount;
      if (typeof raw !== "string" || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error("Inexact Pump.fun quote transfer");
      active.quoteIn += BigInt(raw);
    }
    if (ix.programId === market.baseTokenProgram && ["transfer", "transferChecked"].includes(ix.parsed?.type ?? "") && info) {
      const source = String(info.source), destination = String(info.destination);
      if (!balances.has(source) && !balances.has(destination)) return active;
      if (!balances.has(source) || !balances.has(destination)) throw new Error("Incomplete Pump.fun transfer identity");
      const raw = info.amount ?? (info.tokenAmount as { amount?: string } | undefined)?.amount;
      if (typeof raw !== "string" || !/^\d+$/.test(raw) || BigInt(raw) <= 0n) throw new Error("Inexact Pump.fun token transfer");
      movements.push({ source, destination, amount: BigInt(raw), order: movements.length, swap: active });
    }
    return active;
  }
  for (const [index, outer] of tx.transaction.message.instructions.entries()) {
    const top = visit(outer, null, 1);
    const stack: Array<{ depth: number; swap: Swap | null }> = [{ depth: 1, swap: top }];
    for (const inner of tx.meta.innerInstructions?.find((item) => item.index === index)?.instructions ?? []) {
      const depth = inner.stackHeight;
      if (!Number.isInteger(depth) || depth! < 2) throw new Error("Pump.fun CPI depth unavailable");
      while (stack.length && stack.at(-1)!.depth >= depth!) stack.pop();
      stack.push({ depth: depth!, swap: visit(inner, stack.at(-1)?.swap ?? null, depth!) });
    }
  }
  const events: Array<{ order: number; event: PositionEvent }> = [];
  const used = new Set<Movement>();
  for (const swap of swaps) {
    const matching = movements.filter((item) => item.swap === swap && item.source === (swap.buy ? market.baseVault : swap.userToken) && item.destination === (swap.buy ? swap.userToken : market.baseVault));
    const event = swap.event;
    if (!event || matching.length !== 1 || matching[0].amount !== BigInt(event.tokenAmount.toString())) throw new Error("Pump.fun event and token movements do not reconcile");
    const quote = BigInt((event.quoteAmount.isZero() ? event.solAmount : event.quoteAmount).toString());
    if (quote <= 0n || (swap.buy && swap.quoteIn !== quote)) throw new Error("Pump.fun quote amount does not reconcile");
    used.add(matching[0]);
    events.push({ order: matching[0].order, event: swap.buy ? { kind: "verified_buy", launchId: market.launchId, wallet: swap.user, tokenRaw: matching[0].amount, quoteAtoms: quote, slot } : { kind: "sell", launchId: market.launchId, wallet: swap.user, tokenRaw: matching[0].amount, quoteAtoms: quote, slot } });
  }
  for (const item of movements) if (!used.has(item)) {
    const from = balances.get(item.source)!.owner, to = balances.get(item.destination)!.owner;
    if (from !== market.marketAddress) events.push({ order: item.order, event: { kind: "outgoing_transfer", launchId: market.launchId, wallet: from, tokenRaw: item.amount, slot } });
    if (to !== market.marketAddress) events.push({ order: item.order, event: { kind: "incoming_transfer", launchId: market.launchId, wallet: to, tokenRaw: item.amount, slot } });
  }
  for (const [address, balance] of balances) {
    const delta = movements.reduce((sum, item) => sum + (item.destination === address ? item.amount : 0n) - (item.source === address ? item.amount : 0n), 0n);
    if (delta !== balance.post - balance.pre) throw new Error("Pump.fun transfers do not reconcile to finalized balances");
  }
  return { signature, events: events.sort((a, b) => a.order - b.order).map((item) => item.event) };
}
