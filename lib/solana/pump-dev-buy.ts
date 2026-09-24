import { createHash } from "node:crypto";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, QUOTE_CONTROL_PDA, getBuyTokenAmountFromSolAmount, newBondingCurve } from "./pump-sdk";
import { solanaRpc } from "./rpc";
import type { DevBuyReview } from "./dev-buy";

type Account = { owner: string; executable: boolean; lamports: number; data: [string, string] };
function checked(account: Account | null, owner: PublicKey, name: string) {
  if (!account || account.executable || account.owner !== owner.toBase58() || account.data?.[1] !== "base64") throw new Error(`Unverified Pump ${name}`);
  const data = Buffer.from(account.data[0], "base64");
  if (data.length < 8 || data.length > 32768 || !data.subarray(0, 8).equals(createHash("sha256").update(`account:${name}`).digest().subarray(0, 8))) throw new Error(`Unsupported Pump ${name} layout`);
  return { ...account, owner, data };
}

export async function preparePumpDevBuy(input: { user: PublicKey; mint: PublicKey; creator: PublicKey; quoteMint: PublicKey; quoteTokenProgram: PublicKey; amount: string; atoms: bigint; decimals: number }) {
  const r = await solanaRpc<{ value: Array<Account | null> }>("getMultipleAccounts", [[GLOBAL_PDA.toBase58(), PUMP_FEE_CONFIG_PDA.toBase58(), QUOTE_CONTROL_PDA.toBase58()], { commitment: "finalized", encoding: "base64" }]);
  if (!Array.isArray(r.value) || r.value.length !== 3) throw new Error("Pump dev-buy configuration unavailable");
  const global = PUMP_SDK.decodeGlobal(checked(r.value[0], PUMP_PROGRAM_ID, "Global"));
  const feeConfig = PUMP_SDK.decodeFeeConfig(checked(r.value[1], PUMP_FEE_PROGRAM_ID, "FeeConfig"));
  const control = r.value[2] ? PUMP_SDK.decodeQuoteControl(checked(r.value[2], PUMP_PROGRAM_ID, "QuoteControl")) : null;
  const curve = newBondingCurve(global, input.quoteMint, control);
  const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: new BN(input.atoms.toString()), quoteMint: input.quoteMint, quoteControl: control });
  if (amount.gte(curve.realTokenReserves)) throw new Error("Dev buy must not graduate the new Pump market");
  // A 1% output cushion, with the exact user-entered quote amount as a hard cap.
  // No hidden extra spending tolerance is added to this cap.
  const minimum = amount.muln(99).divn(100);
  if (minimum.lten(0)) throw new Error("Dev buy is too small to receive tokens");
  const destination = getAssociatedTokenAddressSync(input.mint, input.user, false, TOKEN_2022_PROGRAM_ID);
  const buy = await PUMP_SDK.getBuyV2InstructionRaw({ user: input.user, mint: input.mint, creator: input.creator, amount: minimum, quoteAmount: new BN(input.atoms.toString()), tokenProgram: TOKEN_2022_PROGRAM_ID, quoteMint: input.quoteMint, quoteTokenProgram: input.quoteTokenProgram, feeRecipient: global.feeRecipient });
  const devBuy: DevBuyReview = { amount: input.amount, quoteAtoms: input.atoms.toString(), quoteMint: input.quoteMint.toBase58(), quoteDecimals: input.decimals, minimumTokenAtoms: minimum.toString(), tokenDecimals: 6, recipient: input.user.toBase58(), tokenAccount: destination.toBase58() };
  return { instructions: [createAssociatedTokenAccountIdempotentInstruction(input.user, destination, input.user, input.mint, TOKEN_2022_PROGRAM_ID), buy], devBuy };
}
