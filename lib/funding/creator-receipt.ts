import type { FinalizedBlockTransaction } from "@/lib/indexer/launchlab-decoder";
import { TOKEN_PROGRAM } from "@/lib/solana/launchlab-constants";

export type FundingTransaction = FinalizedBlockTransaction & { slot: number; blockTime: number | null };
export interface CreatorReceiptRoute { mint: string; decimals: number; recipient: string; destination: string; source: string; authority: string; launchSlot: number }
const exact = (value: unknown) => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Funding amount is not an exact integer");
  return BigInt(value);
};

/** Reuses the original TopBlast receipt invariant: exact route plus both balance deltas. */
export function verifyCreatorReceipt(tx: FundingTransaction | null, signature: string, route: CreatorReceiptRoute) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature) || !tx || tx.meta?.err !== null || tx.transaction.signatures[0] !== signature
    || !Number.isSafeInteger(tx.slot) || tx.slot < route.launchSlot || !Number.isSafeInteger(tx.blockTime)) throw new Error("Finalized funding receipt is incomplete");
  if (!tx.meta.preTokenBalances || !tx.meta.postTokenBalances || !tx.meta.innerInstructions) throw new Error("Funding token metadata is incomplete");
  if (route.source === route.destination || route.authority === route.recipient) throw new Error("A self-transfer is not new reward funding");
  const instructions = [...tx.transaction.message.instructions, ...tx.meta.innerInstructions.flatMap(group => group.instructions)];
  const matches = instructions.filter(ix => ix.programId === TOKEN_PROGRAM && ix.parsed?.type === "transferChecked"
    && ix.parsed.info?.mint === route.mint && ix.parsed.info.source === route.source
    && ix.parsed.info.destination === route.destination && ix.parsed.info.authority === route.authority);
  if (matches.length !== 1) throw new Error("Funding transfer route is ambiguous");
  const amount = matches[0].parsed!.info!.tokenAmount as { amount?: unknown; decimals?: unknown };
  if (amount?.decimals !== route.decimals || exact(amount.amount) <= 0n) throw new Error("Funding transfer decimals or amount mismatch");
  const keys = tx.transaction.message.accountKeys.map(key => typeof key === "string" ? key : key.pubkey);
  function balance(account: string, phase: "pre" | "post", owner: string) {
    const index = keys.indexOf(account);
    if (index < 0) throw new Error("Funding token account is absent from transaction");
    const rows = tx!.meta![phase === "pre" ? "preTokenBalances" : "postTokenBalances"]!;
    const row = rows.find(item => item.accountIndex === index);
    if (!row) {
      if (phase === "pre" && account === route.destination) return 0n;
      throw new Error("Funding balance metadata is incomplete");
    }
    if (row.mint !== route.mint || row.owner !== owner || row.programId !== TOKEN_PROGRAM) throw new Error("Funding token identity mismatch");
    return exact(row.uiTokenAmount.amount);
  }
  const atoms = exact(amount.amount);
  if (balance(route.destination, "post", route.recipient) - balance(route.destination, "pre", route.recipient) !== atoms) throw new Error("Funding destination delta mismatch");
  if (balance(route.source, "pre", route.authority) - balance(route.source, "post", route.authority) < atoms) throw new Error("Funding source delta mismatch");
  return { signature, slot: tx.slot, blockTime: tx.blockTime!, amountAtoms: atoms.toString(), mint: route.mint, recipient: route.recipient, source: route.source, authority: route.authority };
}

/** Learn only from the transaction explicitly identified by Stonk's official fee response. */
export function routeFromVenueReceipt(tx: FundingTransaction, destination: string, mint: string, decimals: number, recipient: string, launchSlot: number): CreatorReceiptRoute {
  if (!tx.meta?.innerInstructions) throw new Error("Venue receipt metadata unavailable");
  const matches = [...tx.transaction.message.instructions, ...tx.meta.innerInstructions.flatMap(g => g.instructions)]
    .filter(ix => ix.programId === TOKEN_PROGRAM && ix.parsed?.type === "transferChecked" && ix.parsed.info?.destination === destination && ix.parsed.info?.mint === mint);
  if (matches.length !== 1) throw new Error("Venue fee receipt does not identify one exact incoming transfer");
  const info = matches[0].parsed!.info!;
  if (typeof info.source !== "string" || typeof info.authority !== "string") throw new Error("Venue funding source unavailable");
  return { destination, mint, decimals, recipient, launchSlot, source: info.source, authority: info.authority };
}
