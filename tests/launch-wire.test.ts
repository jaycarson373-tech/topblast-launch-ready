import { beforeEach, expect, it, vi } from "vitest";
import { AddressLookupTableAccount, AddressLookupTableProgram, Keypair, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { serializeLaunchTransaction } from "@/lib/solana/launch-wire";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/solana/rpc", () => ({ solanaRpc: mock.rpc }));
beforeEach(() => { vi.restoreAllMocks(); mock.rpc.mockReset(); });
function large() {
  const payer = Keypair.generate().publicKey, program = Keypair.generate().publicKey;
  const addresses = Array.from({ length: 36 }, () => Keypair.generate().publicKey);
  const tx = new Transaction({ feePayer: payer, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(new TransactionInstruction({ programId: program, keys: addresses.map(pubkey => ({ pubkey, isWritable: true, isSigner: false })), data: Buffer.alloc(40) }));
  return { tx, program, addresses };
}
it("keeps a fitting legacy launch unchanged without querying external tables", async () => {
  const f = large(); f.tx.instructions[0].keys = f.tx.instructions[0].keys.slice(0, 2);
  const wire = await serializeLaunchTransaction(f.tx, f.program.toBase58());
  expect(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).version).toBe("legacy");
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("compresses only addresses using finalized active venue lookup tables", async () => {
  const f = large(), tableKey = Keypair.generate().publicKey.toBase58();
  vi.spyOn(AddressLookupTableAccount, "deserialize").mockReturnValue({ deactivationSlot: 18446744073709551615n, lastExtendedSlot: 10, lastExtendedSlotStartIndex: 0, addresses: f.addresses });
  mock.rpc.mockImplementation(async (method: string) => {
    if (method === "getSignaturesForAddress") return [{ signature: "public-receipt", err: null }];
    if (method === "getTransaction") return { transaction: { message: { addressTableLookups: [{ accountKey: tableKey }] } } };
    return { context: { slot: 20 }, value: [{ owner: AddressLookupTableProgram.programId.toBase58(), executable: false, data: [Buffer.alloc(56).toString("base64"), "base64"] }] };
  });
  const wire = Buffer.from(await serializeLaunchTransaction(f.tx, f.program.toBase58()), "base64");
  expect(wire.length).toBeLessThanOrEqual(1232);
  const tx = VersionedTransaction.deserialize(wire);
  expect(tx.version).toBe(0);
  expect(tx.message.addressTableLookups[0].accountKey.toBase58()).toBe(tableKey);
  expect(Buffer.from(tx.message.compiledInstructions[0].data)).toEqual(f.tx.instructions[0].data);
});
it("rejects substituted table owners and never accepts their address data", async () => {
  const f = large(); const decode = vi.spyOn(AddressLookupTableAccount, "deserialize");
  mock.rpc.mockImplementation(async (method: string) => method === "getSignaturesForAddress" ? [{ signature: "receipt", err: null }] : method === "getTransaction" ? { transaction: { message: { addressTableLookups: [{ accountKey: Keypair.generate().publicKey.toBase58() }] } } } : { context: { slot: 20 }, value: [{ owner: f.program.toBase58(), executable: false, data: [Buffer.alloc(56).toString("base64"), "base64"] }] });
  await expect(serializeLaunchTransaction(f.tx, f.program.toBase58())).rejects.toThrow();
  expect(decode).not.toHaveBeenCalled();
});
