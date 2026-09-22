import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { solanaRpc } from "@/lib/solana/rpc";

interface Market {
  launch_id: string;
  launch_slot: string | number;
  last_indexed_slot: string | number;
  quote_mint: string;
  quote_vault: string;
  authority_address: string;
  creator_address: string;
}
interface ParsedInstruction { programId?: string; parsed?: { type?: string; info?: Record<string, unknown> } }
interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: Array<{ instructions: ParsedInstruction[] }>;
  } | null;
  transaction: { signatures: string[]; message: { accountKeys: Array<string | { pubkey: string }>; instructions: ParsedInstruction[] } };
}
interface TokenBalance { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string } }

const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const raw = (value: unknown) => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("Invalid Stonk fee amount");
  return BigInt(value);
};
const key = (value: string | { pubkey: string }) => typeof value === "string" ? value : value.pubkey;

function balance(tx: ParsedTransaction, address: string, phase: "pre" | "post", mint: string, owner: string) {
  const index = tx.transaction.message.accountKeys.map(key).indexOf(address);
  if (index < 0) return phase === "pre" ? 0n : null;
  const row = tx.meta?.[phase === "pre" ? "preTokenBalances" : "postTokenBalances"]?.find((item) => item.accountIndex === index);
  if (!row) return phase === "pre" ? 0n : null;
  if (row.mint !== mint || row.owner !== owner || row.programId !== TOKEN_PROGRAM_ID.toBase58()) throw new Error("Stonk fee token identity mismatch");
  return raw(row.uiTokenAmount.amount);
}

export function verifyStonkForwardedFee(input: {
  tx: ParsedTransaction | null;
  signature: string;
  market: Market;
  treasury: string;
  treasuryTokenAccount: string;
}) {
  const { tx, signature, market, treasury, treasuryTokenAccount } = input;
  if (!signaturePattern.test(signature) || !tx || tx.meta?.err !== null || tx.transaction.signatures[0] !== signature ||
      !Number.isSafeInteger(tx.slot) || tx.slot < Number(market.launch_slot) || !Number.isSafeInteger(tx.blockTime)) {
    throw new Error("Stonk fee transaction is not finalized proof");
  }
  if (!tx.meta || !Array.isArray(tx.meta.preTokenBalances) || !Array.isArray(tx.meta.postTokenBalances) || !Array.isArray(tx.meta.innerInstructions)) {
    throw new Error("Stonk fee transaction metadata is incomplete");
  }
  const instructions = [...tx.transaction.message.instructions, ...tx.meta.innerInstructions.flatMap((group) => group.instructions)];
  const matches = instructions.filter((instruction) => {
    const info = instruction.parsed?.info;
    return instruction.programId === TOKEN_PROGRAM_ID.toBase58() && instruction.parsed?.type === "transferChecked" &&
      info?.mint === market.quote_mint && info.source === market.quote_vault && info.destination === treasuryTokenAccount &&
      info.authority === market.authority_address;
  });
  if (matches.length !== 1) throw new Error("Stonk fee transfer route is ambiguous");
  const amount = raw(matches[0].parsed!.info!.tokenAmount && (matches[0].parsed!.info!.tokenAmount as Record<string, unknown>).amount);
  if (amount <= 0n) throw new Error("Empty Stonk fee receipt");
  const before = balance(tx, treasuryTokenAccount, "pre", market.quote_mint, treasury) ?? 0n;
  const after = balance(tx, treasuryTokenAccount, "post", market.quote_mint, treasury);
  if (after === null || after - before !== amount) throw new Error("Stonk fee destination delta mismatch");
  const sourceBefore = balance(tx, market.quote_vault, "pre", market.quote_mint, market.authority_address);
  const sourceAfter = balance(tx, market.quote_vault, "post", market.quote_mint, market.authority_address);
  if (sourceBefore === null || sourceAfter === null || sourceBefore - sourceAfter < amount) throw new Error("Stonk fee source delta mismatch");
  return { signature, amountAtoms: amount.toString(), slot: tx.slot, blockTime: new Date(tx.blockTime! * 1000).toISOString() };
}

export async function reconcileStonkForwardedFees(db: SupabaseClient, market: Market) {
  const treasury = process.env.TOPBLAST_TREASURY_ADDRESS;
  if (!treasury || market.creator_address !== treasury || Number(market.last_indexed_slot) < Number(market.launch_slot)) return { credited: 0 };
  const treasuryTokenAccount = getAssociatedTokenAddressSync(new PublicKey(market.quote_mint), new PublicKey(treasury), false, TOKEN_PROGRAM_ID).toBase58();
  const signatures = await solanaRpc<Array<{ signature: string; slot: number; err: unknown }>>("getSignaturesForAddress", [treasuryTokenAccount, { limit: 250, commitment: "finalized" }]);
  if (!Array.isArray(signatures)) throw new Error("Stonk fee history is unavailable");
  let credited = 0;
  for (const row of signatures.filter((item) => !item.err && item.slot >= Number(market.launch_slot) && item.slot <= Number(market.last_indexed_slot)).reverse()) {
    const existing = await db.from("fee_events").select("id,launch_id").eq("signature", row.signature).eq("asset_mint", market.quote_mint).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.launch_id !== market.launch_id) throw new Error("A Stonk fee receipt is already attributed to another launch");
      continue;
    }
    const tx = await solanaRpc<ParsedTransaction | null>("getTransaction", [row.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    let proof;
    try { proof = verifyStonkForwardedFee({ tx, signature: row.signature, market, treasury, treasuryTokenAccount }); }
    catch (error) {
      if (error instanceof Error && error.message === "Stonk fee transfer route is ambiguous") continue;
      throw error;
    }
    const result = await db.rpc("credit_stonk_forwarded_fee", {
      p_launch_id: market.launch_id, p_signature: proof.signature, p_amount_atoms: proof.amountAtoms,
      p_slot: proof.slot, p_block_time: proof.blockTime,
      p_proof: { version: 1, ...proof, source: market.quote_vault, sourceOwner: market.authority_address, destination: treasuryTokenAccount, treasury },
    });
    if (result.error) throw result.error;
    if (result.data === true) credited += 1;
  }
  return { credited };
}
