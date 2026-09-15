// Read-only acceptance aid. Never signs or submits a transaction.
import { PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { PUMP_SDK, PUMP_PROGRAM_ID, pumpIdl } from "../lib/solana/pump-sdk";
import { solanaRpc } from "../lib/solana/rpc";
import { inspectPumpMarket, PUMP_SOL_MINT } from "../lib/solana/pumpfun";
import { decode58, type FinalizedBlockTransaction } from "../lib/indexer/launchlab-decoder";
import { decodeFinalizedPumpTransaction } from "../lib/indexer/pumpfun-decoder";

process.env.SOLANA_RPC_URL ??= "https://api.mainnet-beta.solana.com";
async function main() {
  const signatures = await solanaRpc<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [PUMP_PROGRAM_ID.toBase58(), { limit: 10, commitment: "finalized" }]);
  for (const row of signatures.filter((item) => !item.err)) {
    const tx = await solanaRpc<(FinalizedBlockTransaction & { slot: number }) | null>("getTransaction", [row.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (!tx) continue;
    const instructions = [...tx.transaction.message.instructions, ...tx.meta?.innerInstructions?.flatMap((item) => item.instructions) ?? []];
    for (const ix of instructions) {
      if (ix.programId !== PUMP_PROGRAM_ID.toBase58() || !ix.data) continue;
      const definition = pumpIdl.instructions.find((item) => ["buy", "buy_exact_sol_in", "buy_v2", "buy_exact_quote_in_v2", "sell", "sell_v2"].includes(item.name) && Buffer.from(item.discriminator).equals(decode58(ix.data!).subarray(0, 8)));
      if (!definition) continue;
      const accounts = Object.fromEntries(definition.accounts.map((item, index) => [item.name, ix.accounts?.[index]]));
      const mint = accounts.base_mint ?? accounts.mint, pool = accounts.bonding_curve;
      if (!mint || !pool) continue;
      const raw = await solanaRpc<{ value: { owner: string; data: [string, string]; lamports: number; executable: boolean } | null }>("getAccountInfo", [pool, { encoding: "base64", commitment: "finalized" }]);
      if (!raw.value || raw.value.owner !== PUMP_PROGRAM_ID.toBase58()) continue;
      const curve = PUMP_SDK.decodeBondingCurve({ ...raw.value, owner: PUMP_PROGRAM_ID, data: Buffer.from(raw.value.data[0], "base64") });
      if (curve.complete || curve.isMayhemMode || curve.isHolderReward || curve.isCashbackCoin) continue;
      const market = await inspectPumpMarket({ mint, pool, creator: curve.creator.toBase58(), quoteMint: PUMP_SOL_MINT, launchSignature: row.signature });
      const decoded = decodeFinalizedPumpTransaction(tx, { ...market, launchId: "readonly-verification", marketAddress: pool, baseMint: mint, quoteMint: PUMP_SOL_MINT }, BigInt(tx.slot));
      console.log(JSON.stringify({ verifiedSignature: row.signature, slot: tx.slot, mint, pool, events: decoded.events.map((event) => ({ ...event, tokenRaw: event.tokenRaw.toString(), slot: event.slot.toString(), ...event.kind === "verified_buy" ? { quoteAtoms: event.quoteAtoms.toString() } : {} })) }));
      const payerKey = tx.transaction.message.accountKeys.find((item) => typeof item !== "string" && item.signer);
      if (!payerKey || typeof payerKey === "string") throw new Error("No public simulation fee payer");
      const payer = new PublicKey(payerKey.pubkey);
      // A random public mint is enough for sigVerify:false. No key is created or held.
      const mintBytes = new Uint8Array(32); crypto.getRandomValues(mintBytes); const simulatedMint = new PublicKey(mintBytes);
      const create = await PUMP_SDK.createV2Instruction({ mint: simulatedMint, user: payer, creator: payer, name: "TopBlast simulation", symbol: "TBSIM", uri: "https://topblast-stonkfun-launchpad.vercel.app", mayhemMode: false, cashback: false, holderReward: false });
      const latest = await solanaRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
      const transaction = new Transaction({ feePayer: payer, recentBlockhash: latest.value.blockhash }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), create);
      const result = await solanaRpc<{ value: { err: unknown; logs?: string[]; unitsConsumed?: number } }>("simulateTransaction", [transaction.serialize({ requireAllSignatures: false }).toString("base64"), { encoding: "base64", sigVerify: false, commitment: "finalized" }]);
      console.log(JSON.stringify({ creationSimulation: result.value.err ? "failed" : "passed", error: result.value.err, units: result.value.unitsConsumed, logs: result.value.err ? result.value.logs?.slice(-5) : undefined, signed: false, submitted: false }));
      if (result.value.err) process.exitCode = 1;
      return;
    }
  }
  throw new Error("No supported recent Pump.fun curve trade found; retry the read-only check");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Read-only verification failed"); process.exitCode = 1; });
