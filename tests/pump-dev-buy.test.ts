import { createHash } from "node:crypto";
import BN from "bn.js";
import { beforeEach, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_SDK } from "@/lib/solana/pump-sdk";
import { preparePumpDevBuy } from "@/lib/solana/pump-dev-buy";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
vi.mock("@/lib/solana/pump-sdk", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/solana/pump-sdk")>();
  return { ...actual, newBondingCurve: () => ({ realTokenReserves: new BN(1000000) }), getBuyTokenAmountFromSolAmount: () => new BN(10000) };
});
beforeEach(() => { vi.restoreAllMocks(); mock.rpc.mockReset(); });
const input = () => ({ user: Keypair.generate().publicKey, mint: Keypair.generate().publicKey, creator: Keypair.generate().publicKey, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID, amount: "0.001", atoms: 1000000n, decimals: 9 });
function account(name: string, owner: string) { return { owner, executable: false, lamports: 1, data: [createHash("sha256").update(`account:${name}`).digest().subarray(0, 8).toString("base64"), "base64"] }; }
it("uses the entered quote cap including fees and sends the dev tokens directly to the creator wallet", async () => {
  const feeRecipient = Keypair.generate().publicKey;
  vi.spyOn(PUMP_SDK, "decodeGlobal").mockReturnValue({ feeRecipient } as ReturnType<typeof PUMP_SDK.decodeGlobal>);
  vi.spyOn(PUMP_SDK, "decodeFeeConfig").mockReturnValue({} as ReturnType<typeof PUMP_SDK.decodeFeeConfig>);
  mock.rpc.mockResolvedValue({ value: [account("Global", PUMP_PROGRAM_ID.toBase58()), account("FeeConfig", PUMP_FEE_PROGRAM_ID.toBase58()), null] });
  const builder = vi.spyOn(PUMP_SDK, "getBuyV2InstructionRaw");
  const i = input(), result = await preparePumpDevBuy(i);
  expect(result.devBuy).toMatchObject({ recipient: i.user.toBase58(), quoteAtoms: "1000000", minimumTokenAtoms: "9900" });
  expect(builder.mock.calls[0][0].quoteAmount.toString()).toBe("1000000");
  expect(builder.mock.calls[0][0].user.equals(i.user)).toBe(true);
  expect(result.instructions).toHaveLength(2);
});
it("rejects an unverified fee configuration before constructing a buy", async () => {
  vi.spyOn(PUMP_SDK, "decodeGlobal").mockReturnValue({} as ReturnType<typeof PUMP_SDK.decodeGlobal>);
  const builder = vi.spyOn(PUMP_SDK, "getBuyV2InstructionRaw");
  mock.rpc.mockResolvedValue({ value: [account("Global", PUMP_PROGRAM_ID.toBase58()), account("FeeConfig", PUMP_PROGRAM_ID.toBase58()), null] });
  await expect(preparePumpDevBuy(input())).rejects.toThrow("Unverified Pump FeeConfig");
  expect(builder).not.toHaveBeenCalled();
});
