import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getTreasuryBalance } from "@/lib/solana/rpc";

const owner = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const mint = "So11111111111111111111111111111111111111112";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SOLANA_RPC_URL;
});

describe("treasury RPC monitor", () => {
  it("reads finalized SOL and token balances", async () => {
    process.env.SOLANA_RPC_URL = "https://rpc.example.invalid";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 10_000_000_000 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [
        { account: { data: { parsed: { info: { tokenAmount: { amount: "40" } } } } } },
        { account: { data: { parsed: { info: { tokenAmount: { amount: "2" } } } } } },
      ] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getTreasuryBalance(owner, mint)).resolves.toMatchObject({ solLamports: "10000000000", sol: 10, rewardAtoms: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed addresses before calling RPC", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getTreasuryBalance("not-a-wallet")).rejects.toThrow("valid Solana address");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

