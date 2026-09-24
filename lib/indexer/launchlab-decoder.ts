import { LAUNCHLAB_PROGRAM } from "@/lib/solana/launchlab-constants";
import type { PositionEvent } from "@/lib/rewards/position";

const SWAPS = new Map([
  ["250,234,13,123,213,156,19,236", "buy"],
  ["24,211,116,40,105,3,153,56", "buy"],
  ["149,39,222,155,211,124,152,26", "sell"],
  ["95,200,71,34,8,9,11,166", "sell"],
]);
const ACCOUNTS = ["payer", "authority", "config", "platform", "pool", "userBase", "userQuote", "baseVault", "quoteVault", "baseMint", "quoteMint", "baseProgram", "quoteProgram", "eventAuthority", "program"] as const;
const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

interface ParsedInstruction { programId?: string; accounts?: string[]; data?: string; stackHeight?: number; parsed?: { type?: string; info?: Record<string, unknown> } }
interface TokenBalance { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } }
export interface FinalizedBlockTransaction {
  meta: { err: unknown; innerInstructions?: Array<{ index: number; instructions: ParsedInstruction[] }>; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { signatures: string[]; message: { accountKeys: Array<string | { pubkey: string; signer?: boolean }>; instructions: ParsedInstruction[] } };
}
export interface LaunchLabDecoderMarket {
  launchId: string; marketAddress: string; baseMint: string; quoteMint: string; authorityAddress: string;
  configAddress: string; platformConfigAddress: string; baseVault: string; quoteVault: string;
  baseTokenProgram: string; quoteTokenProgram: string; creatorAddress: string;
}
interface Balance { mint: string; owner: string; program: string; pre: bigint; post: bigint }
interface Transfer { source: string; destination: string; from: string; to: string; mint: string; amount: bigint; sequence: number; context: SwapContext | null }
interface SwapContext { side: "buy" | "sell"; payer: string; input: string; output: string; transfers: Transfer[] }

// Creation can mint the initial pool inventory in the same transaction as a
// first buy. Reconcile that issuance only at the verified pool vault. It never
// creates a wallet event or purchased basis, and user balances remain exact.
export function poolMintIssuance(ix: ParsedInstruction, market: Pick<LaunchLabDecoderMarket, "baseTokenProgram" | "baseMint" | "baseVault">): bigint {
  if (ix.programId !== market.baseTokenProgram || !["mintTo", "mintToChecked"].includes(ix.parsed?.type ?? "")) return 0n;
  const info = ix.parsed?.info;
  if (info?.mint !== market.baseMint || info.account !== market.baseVault) return 0n;
  const amount = info.amount ?? (info.tokenAmount as { amount?: unknown } | undefined)?.amount;
  if (typeof amount !== "string" || !/^[1-9]\d*$/.test(amount)) throw new Error("Pool supply issuance amount is not exact");
  return BigInt(amount);
}

export function decode58(value: string) {
  let number = 0n;
  for (const character of value) { const digit = ALPHABET.indexOf(character); if (digit < 0) throw new Error("Invalid base58 instruction data"); number = number * 58n + BigInt(digit); }
  let hex = number.toString(16); if (hex.length % 2) hex = `0${hex}`;
  return Buffer.concat([Buffer.alloc(value.match(/^1*/)?.[0].length ?? 0), number ? Buffer.from(hex, "hex") : Buffer.alloc(0)]);
}

function context(instruction: ParsedInstruction, market: LaunchLabDecoderMarket, signers: Set<string>): SwapContext | null {
  if (instruction.programId !== LAUNCHLAB_PROGRAM || !instruction.data || !instruction.accounts) return null;
  const side = SWAPS.get([...decode58(instruction.data).subarray(0, 8)].join(",")) as "buy" | "sell" | undefined;
  if (!side) return null;
  const account = Object.fromEntries(ACCOUNTS.map((name, index) => [name, instruction.accounts?.[index]])) as Record<typeof ACCOUNTS[number], string | undefined>;
  if (account.pool !== market.marketAddress || account.authority !== market.authorityAddress || account.config !== market.configAddress || account.platform !== market.platformConfigAddress || account.baseVault !== market.baseVault || account.quoteVault !== market.quoteVault || account.baseMint !== market.baseMint || account.quoteMint !== market.quoteMint || account.baseProgram !== market.baseTokenProgram || account.quoteProgram !== market.quoteTokenProgram || account.program !== LAUNCHLAB_PROGRAM) throw new Error("LaunchLab swap account identity mismatch");
  if (!account.payer || !signers.has(account.payer) || !account.userBase || !account.userQuote) throw new Error("LaunchLab payer is not a transaction signer");
  return { side, payer: account.payer, input: side === "buy" ? account.userQuote : account.userBase, output: side === "buy" ? account.userBase : account.userQuote, transfers: [] };
}

export function decodeFinalizedLaunchLabTransaction(tx: FinalizedBlockTransaction, market: LaunchLabDecoderMarket, slot: bigint): { signature: string; events: PositionEvent[] } {
  if (!tx.meta) throw new Error("Finalized transaction metadata is missing");
  const signature = tx.transaction.signatures[0];
  if (!signature) throw new Error("Finalized transaction signature is missing");
  if (tx.meta.err) return { signature, events: [] };
  const keyRows = tx.transaction.message.accountKeys;
  const keys = keyRows.map((item) => typeof item === "string" ? item : item.pubkey);
  const signers = new Set(keyRows.filter((item) => typeof item !== "string" && item.signer).map((item) => typeof item === "string" ? item : item.pubkey));
  const allBalances = [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])];
  const relevant = keys.includes(market.marketAddress) || allBalances.some((item) => item.mint === market.baseMint);
  if (!relevant) return { signature, events: [] };
  const balances = new Map<string, Balance>();
  for (const phase of ["pre", "post"] as const) for (const item of tx.meta[phase === "pre" ? "preTokenBalances" : "postTokenBalances"] ?? []) {
    if (!item.owner || !item.programId || !TOKEN_PROGRAMS.has(item.programId)) throw new Error("Incomplete token balance identity");
    const account = keys[item.accountIndex]; if (!account) throw new Error("Token balance account index is invalid");
    const previous = balances.get(account);
    if (previous && (previous.mint !== item.mint || previous.owner !== item.owner || previous.program !== item.programId)) throw new Error("Token account identity changed during transaction");
    balances.set(account, { mint: item.mint, owner: item.owner, program: item.programId, pre: previous?.pre ?? 0n, post: previous?.post ?? 0n, [phase]: BigInt(item.uiTokenAmount.amount) });
  }
  for (const item of balances.values()) {
    const expected = item.mint === market.baseMint ? market.baseTokenProgram : item.mint === market.quoteMint ? market.quoteTokenProgram : null;
    if (expected && item.program !== expected) throw new Error("Unexpected token program for tracked mint");
  }
  const contexts: SwapContext[] = [];
  const transfers: Transfer[] = [];
  let sequence = 0;
  let poolIssuance = 0n;
  function visit(instruction: ParsedInstruction, active: SwapContext | null) {
    poolIssuance += poolMintIssuance(instruction, market);
    if (!instruction.programId || !TOKEN_PROGRAMS.has(instruction.programId) || !instruction.parsed) return;
    const info = instruction.parsed.info ?? {};
    if (!["transfer", "transferChecked"].includes(instruction.parsed.type ?? "")) return;
    const sourceAddress = String(info.source ?? ""), destinationAddress = String(info.destination ?? "");
    const source = balances.get(sourceAddress), destination = balances.get(destinationAddress);
    if (!source && !destination) return;
    const instructionMint = typeof info.mint === "string" ? info.mint : null;
    const mint = source?.mint ?? destination?.mint ?? instructionMint;
    if (mint !== market.baseMint && mint !== market.quoteMint) return;
    if (instructionMint && instructionMint !== mint) throw new Error("Tracked transfer mint identity changed");
    const ephemeralQuoteSource = !source && Boolean(active && active.side === "buy" && sourceAddress === active.input && mint === market.quoteMint && instruction.programId === market.quoteTokenProgram);
    const ephemeralQuoteDestination = !destination && Boolean(active && active.side === "sell" && destinationAddress === active.output && mint === market.quoteMint && instruction.programId === market.quoteTokenProgram);
    if ((!source && !ephemeralQuoteSource) || (!destination && !ephemeralQuoteDestination)) throw new Error("Tracked transfer ownership is incomplete");
    if (source && destination && (source.mint !== destination.mint || source.program !== destination.program)) throw new Error("Tracked transfer ownership is incomplete");
    if ((source?.program ?? destination?.program) !== instruction.programId) throw new Error("Tracked transfer token program mismatch");
    const rawAmount = info.amount ?? (info.tokenAmount as { amount?: unknown } | undefined)?.amount;
    if (typeof rawAmount !== "string" || !/^\d+$/.test(rawAmount) || BigInt(rawAmount) <= 0n) throw new Error("Tracked transfer amount is not exact");
    const transfer: Transfer = { source: sourceAddress, destination: destinationAddress, from: source?.owner ?? active!.payer, to: destination?.owner ?? active!.payer, mint, amount: BigInt(rawAmount), sequence: sequence++, context: active };
    transfers.push(transfer); active?.transfers.push(transfer);
  }
  for (const [outerIndex, outer] of tx.transaction.message.instructions.entries()) {
    const top = context(outer, market, signers); if (top) contexts.push(top);
    const stack: Array<{ height: number; context: SwapContext | null }> = [{ height: 1, context: top }]; visit(outer, top);
    for (const inner of (tx.meta.innerInstructions ?? []).find((item) => item.index === outerIndex)?.instructions ?? []) {
      if (!Number.isInteger(inner.stackHeight)) throw new Error("CPI stack height is missing");
      while ((stack.at(-1)?.height ?? 0) >= inner.stackHeight!) stack.pop();
      const own = context(inner, market, signers); if (own) contexts.push(own);
      const active = own ?? stack.at(-1)?.context ?? null; visit(inner, active); stack.push({ height: inner.stackHeight!, context: active });
    }
  }
  const events: Array<PositionEvent & { order: number }> = [];
  const used = new Set<Transfer>();
  for (const swap of contexts) {
    const base = swap.transfers.find((item) => item.mint === market.baseMint && (swap.side === "buy" ? item.source === market.baseVault && item.destination === swap.output : item.destination === market.baseVault && item.source === swap.input));
    const quote = swap.transfers.find((item) => item.mint === market.quoteMint && (swap.side === "buy" ? item.destination === market.quoteVault && item.source === swap.input : item.source === market.quoteVault && item.destination === swap.output));
    if (!base || !quote) throw new Error("LaunchLab swap token movements are incomplete");
    if (swap.side === "buy" && (base.to !== swap.payer || quote.destination !== market.quoteVault)) throw new Error("LaunchLab buy payer mismatch");
    if (swap.side === "sell" && (base.from !== swap.payer || quote.source !== market.quoteVault)) throw new Error("LaunchLab sell payer mismatch");
    used.add(base);
    events.push(swap.side === "buy"
      ? { kind: "verified_buy", launchId: market.launchId, wallet: swap.payer, tokenRaw: base.amount, quoteAtoms: quote.amount, slot, order: base.sequence }
      : { kind: "sell", launchId: market.launchId, wallet: swap.payer, tokenRaw: base.amount, quoteAtoms: quote.amount, slot, order: base.sequence });
  }
  for (const transfer of transfers) if (transfer.mint === market.baseMint && !used.has(transfer)) {
    if (![market.authorityAddress, market.marketAddress].includes(transfer.from)) events.push({ kind: "outgoing_transfer", launchId: market.launchId, wallet: transfer.from, tokenRaw: transfer.amount, slot, order: transfer.sequence });
    if (![market.authorityAddress, market.marketAddress].includes(transfer.to)) events.push({ kind: "incoming_transfer", launchId: market.launchId, wallet: transfer.to, tokenRaw: transfer.amount, slot, order: transfer.sequence });
  }
  for (const [account, balance] of balances) if (balance.mint === market.baseMint) {
    const predicted = transfers.reduce((sum, item) => sum + (item.destination === account ? item.amount : 0n) - (item.source === account ? item.amount : 0n), account === market.baseVault ? poolIssuance : 0n);
    if (predicted !== balance.post - balance.pre) throw new Error("Parsed transfers do not reconcile to finalized token balances");
  }
  return { signature, events: events.sort((a, b) => a.order - b.order).map((item): PositionEvent => item.kind === "verified_buy"
    ? { kind: item.kind, launchId: item.launchId, wallet: item.wallet, tokenRaw: item.tokenRaw, quoteAtoms: item.quoteAtoms, slot: item.slot }
    : item.kind === "sell"
      ? { kind: item.kind, launchId: item.launchId, wallet: item.wallet, tokenRaw: item.tokenRaw, quoteAtoms: item.quoteAtoms, slot: item.slot }
      : { kind: item.kind, launchId: item.launchId, wallet: item.wallet, tokenRaw: item.tokenRaw, slot: item.slot }) };
}
