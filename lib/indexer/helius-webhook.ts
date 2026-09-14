interface HeliusWebhook {
  webhookID: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
  authHeader?: string;
  encoding?: string;
  txnStatus?: string;
  active?: boolean;
}

function configuration() {
  const apiKey = process.env.HELIUS_API_KEY;
  const webhookId = process.env.HELIUS_WEBHOOK_ID;
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!apiKey || !webhookId || !secret) throw new Error("HELIUS_API_KEY, HELIUS_WEBHOOK_ID, and HELIUS_WEBHOOK_SECRET are required");
  return { apiKey, webhookId, secret };
}

export async function addHeliusWebhookAddresses(addresses: string[]): Promise<void> {
  const { apiKey, webhookId, secret } = configuration();
  const endpoint = `https://api-mainnet.helius-rpc.com/v0/webhooks/${encodeURIComponent(webhookId)}?api-key=${encodeURIComponent(apiKey)}`;
  const currentResponse = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!currentResponse.ok) throw new Error(`Helius webhook lookup returned HTTP ${currentResponse.status}`);
  const current = await currentResponse.json() as HeliusWebhook;
  const treasury = process.env.TOPBLAST_TREASURY_ADDRESS?.trim();
  const accountAddresses = [...new Set([...(current.accountAddresses ?? []), ...addresses, treasury].filter((address): address is string => Boolean(address)))];
  if (accountAddresses.length === current.accountAddresses?.length) return;
  const updateResponse = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookURL: current.webhookURL,
      transactionTypes: current.transactionTypes?.length ? current.transactionTypes : ["ANY"],
      accountAddresses,
      webhookType: current.webhookType || "enhanced",
      authHeader: `Bearer ${secret}`,
      encoding: current.encoding,
      txnStatus: current.txnStatus,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!updateResponse.ok) throw new Error(`Helius webhook update returned HTTP ${updateResponse.status}`);
}
