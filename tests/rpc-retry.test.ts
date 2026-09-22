import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { solanaRpc } from "@/lib/solana/rpc";

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.invalid"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const lag = () => Response.json({ error: { code: -32016, message: "Minimum context slot has not been reached" } });

it.each(["getBalance", "simulateTransaction"])("retries %s node lag without changing the finalized context or transaction", async (method) => {
  const params = ["unchanged-input", { commitment: "finalized", minContextSlot: 456 }];
  const fetchMock = vi.fn().mockResolvedValueOnce(lag()).mockResolvedValueOnce(lag()).mockResolvedValueOnce(Response.json({ result: { context: { slot: 457 }, value: 100 } }));
  vi.stubGlobal("fetch", fetchMock);
  const assertion = expect(solanaRpc(method, params)).resolves.toEqual({ context: { slot: 457 }, value: 100 });
  await vi.runAllTimersAsync(); await assertion;
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(init.body)).toMatchObject({ method, params });
});

it("fails closed after a bounded number of lag retries", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => lag()); vi.stubGlobal("fetch", fetchMock);
  const assertion = expect(solanaRpc("getBalance", ["wallet", { commitment: "finalized", minContextSlot: 999 }])).rejects.toThrow("still catching up");
  await vi.runAllTimersAsync(); await assertion;
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it("still retries unhealthy-node JSON errors without cancelling a consumed stream", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: -32005, message: "Node is unhealthy" } })).mockResolvedValueOnce(Response.json({ result: 42 }));
  vi.stubGlobal("fetch", fetchMock);
  const assertion = expect(solanaRpc("getSlot")).resolves.toBe(42);
  await vi.runAllTimersAsync(); await assertion;
});

it("does not retry failed transaction preflight or alter its result", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { code: -32002, message: "Transaction simulation failed" } }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(solanaRpc("simulateTransaction", ["original-wire"])).rejects.toThrow("Transaction simulation failed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
