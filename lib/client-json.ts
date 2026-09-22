// Bound both connection and body reads. Timing out does not cancel an onchain
// transaction: callers must retain the receipt and recover its status.
export async function clientJson(url: string, init: RequestInit, timeoutMs: number, timeoutMessage: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const body = await response.json();
        return { response, body };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(timeoutMessage)); controller.abort(); }, timeoutMs);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
