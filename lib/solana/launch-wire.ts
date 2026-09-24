import { AddressLookupTableAccount, AddressLookupTableProgram, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { solanaRpc } from "./rpc";

const cache = new Map<string, { at: number; tables: AddressLookupTableAccount[] }>();
// Read existing tables used by finalized venue transactions. No table creation,
// treasury spending, or third-party transaction instructions are involved.
async function venueTables(program: string) {
  const previous = cache.get(program);
  if (previous && Date.now() - previous.at < 300_000) return previous.tables;
  const signatures = await solanaRpc<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [program, { limit: 12, commitment: "finalized" }]);
  const transactions = await Promise.all(signatures.filter(s => s.err === null).slice(0, 8).map(async s => {
    try { return await solanaRpc<{ transaction: { message: { addressTableLookups?: Array<{ accountKey: string }> } } } | null>("getTransaction", [s.signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]); }
    catch (error) { if (error instanceof Error && error.message.includes("-32015")) return null; throw error; }
  }));
  const keys = [...new Set(transactions.flatMap(t => t?.transaction.message.addressTableLookups?.map(a => a.accountKey) ?? []))].slice(0, 20);
  if (!keys.length) throw new Error("No verified venue lookup table available for atomic dev buy. Retry shortly; no transaction was sent.");
  const accounts = await solanaRpc<{ context: { slot: number }; value: Array<{ owner: string; executable: boolean; data: [string, string] } | null> }>("getMultipleAccounts", [keys, { commitment: "finalized", encoding: "base64" }]);
  const tables = accounts.value.flatMap((a, i) => {
    if (!a || a.executable || a.owner !== AddressLookupTableProgram.programId.toBase58() || a.data?.[1] !== "base64") return [];
    const bytes = Buffer.from(a.data[0], "base64");
    if (bytes.length < 56 || bytes.length > 8248) return [];
    let state;
    try { state = AddressLookupTableAccount.deserialize(bytes); } catch { return []; }
    const table = new AddressLookupTableAccount({ key: new PublicKey(keys[i]), state });
    return table.isActive() && state.lastExtendedSlot < accounts.context.slot ? [table] : [];
  });
  cache.set(program, { at: Date.now(), tables });
  return tables;
}

export async function serializeLaunchTransaction(tx: Transaction, venueProgram: string) {
  // Keep the established legacy flow when it fits. Complex atomic launches use
  // v0 to compress addresses, not to split creation and buying into two payments.
  try { const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }); if (bytes.length <= 1232) return bytes.toString("base64"); } catch (error) { if (!(error instanceof Error) || !/too large|overrun|outside|bounds/i.test(error.message)) throw error; }
  const tables = await venueTables(venueProgram);
  const relevant = new Set(tx.instructions.flatMap(ix => ix.keys.filter(k => !k.isSigner).map(k => k.pubkey.toBase58())));
  const ranked = tables.map(table => ({ table, score: table.state.addresses.filter(a => relevant.has(a.toBase58())).length })).filter(t => t.score > 1).sort((a, b) => b.score - a.score);
  const message = new TransactionMessage({ payerKey: tx.feePayer!, recentBlockhash: tx.recentBlockhash!, instructions: tx.instructions }).compileToV0Message(ranked.map(t => t.table));
  const wire = new VersionedTransaction(message).serialize();
  if (wire.length > 1232) throw new Error("Atomic launch exceeds the venue transaction size limit. Shorten the token name or retry for a current lookup table; no payment was made.");
  return Buffer.from(wire).toString("base64");
}
