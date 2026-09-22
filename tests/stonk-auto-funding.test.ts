import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { verifyStonkForwardedFee } from "@/lib/funding/stonk-auto";

const address = () => Keypair.generate().publicKey.toBase58();

describe("automatic Stonk creator-fee funding", () => {
  it("accepts only the exact launch vault to treasury transfer and measured balance delta", () => {
    const signature = "2".repeat(64), treasury = address(), treasuryTokenAccount = address();
    const market = { launch_id: "launch-a", launch_slot: 10, last_indexed_slot: 30, quote_mint: address(), quote_vault: address(), authority_address: address(), creator_address: treasury };
    const tx = {
      slot: 20, blockTime: 1_800_000_000, meta: { err: null,
        preTokenBalances: [
          { accountIndex: 0, mint: market.quote_mint, owner: treasury, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: "25" } },
          { accountIndex: 1, mint: market.quote_mint, owner: market.authority_address, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: "100" } },
        ],
        postTokenBalances: [
          { accountIndex: 0, mint: market.quote_mint, owner: treasury, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: "35" } },
          { accountIndex: 1, mint: market.quote_mint, owner: market.authority_address, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: "90" } },
        ],
        innerInstructions: [{ instructions: [{ programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: "transferChecked", info: {
          mint: market.quote_mint, source: market.quote_vault, destination: treasuryTokenAccount, authority: market.authority_address,
          tokenAmount: { amount: "10" },
        } } }] }],
      },
      transaction: { signatures: [signature], message: { accountKeys: [treasuryTokenAccount, market.quote_vault], instructions: [] } },
    };
    expect(verifyStonkForwardedFee({ tx, signature, market, treasury, treasuryTokenAccount })).toMatchObject({ amountAtoms: "10", slot: 20 });
    expect(() => verifyStonkForwardedFee({ tx, signature, market: { ...market, quote_vault: address() }, treasury, treasuryTokenAccount })).toThrow("ambiguous");
  });
});
