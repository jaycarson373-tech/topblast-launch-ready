import type {
  CreatorFees,
  LaunchVenueAdapter,
  PreparedFeeClaim,
  PreparedLaunch,
  SubmittedLaunch,
  VenueLaunch,
  VenuePair,
  VenueMarketData,
} from "@/lib/venue/launch-venue-adapter";
import type { LaunchDraft } from "@/lib/types";
import { getAdminDb } from "@/lib/db/server";
import { prepareStonkLaunch, verifyStonkPricing, isStonkDirectQuote, recoverStonkLaunch } from "@/lib/solana/stonk-launchlab";
import { paymentSignatureFromTransaction } from "@/lib/solana/transaction-signature";
import { z } from "zod";
import { isAddress } from "@solana/addresses";

type ApiEnvelope = { data?: Record<string, unknown>; error?: { code?: string; message?: string; retryable?: boolean } };

export class StonkFunApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly details: Record<string, unknown> = {},
  ) { super(message); }
}

const stringValue = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

export class StonkFunAdapter implements LaunchVenueAdapter {
  readonly venue = "stonkfun";
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.STONKFUN_API_URL ?? "https://www.stonkfun.xyz/api/public/v1") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json() as ApiEnvelope;
    if (!response.ok || body.error) {
      const error = body.error ?? {};
      throw new StonkFunApiError(
        error.code ?? "stonkfun_error",
        error.message ?? `StonkFun returned HTTP ${response.status}`,
        response.status,
        error.retryable ?? response.status >= 500,
        { ...body, ...error },
      );
    }
    return body.data ?? {};
  }

  async getCreationConfig(quoteMint: string) {
    return verifyStonkPricing(await this.call(`/launchlab/pricing?quoteMint=${encodeURIComponent(quoteMint)}`), quoteMint);
  }

  async createLaunch(input: LaunchDraft): Promise<PreparedLaunch> {
    if (input.feeTier !== "1%") throw new Error("The old Stonk fee-tier selector is no longer supported. Refresh the form; venue fees now come from Stonk's onchain configuration.");
    return prepareStonkLaunch(input, await this.getCreationConfig(input.quoteMint));
  }

  async submitLaunch(input: { signedQuote: string; signedTransaction: string; logo: string }): Promise<SubmittedLaunch> {
    if (isStonkDirectQuote(input.signedQuote)) {
      return this.getLaunch(paymentSignatureFromTransaction(Buffer.from(input.signedTransaction, "base64")));
    }
    // Recovery only for previously prepared legacy fee-payment launches.
    const data = await this.call("/launches/submit", { method: "POST", body: JSON.stringify(input) });
    return this.normalizeSubmitted(data);
  }

  async getLaunch(paymentSignature: string): Promise<VenueLaunch> {
    const { data: receipt, error } = await getAdminDb().from("launch_submission_receipts")
      .select("signed_quote,signed_payment_transaction").eq("payment_signature", paymentSignature).maybeSingle();
    if (error) throw error;
    if (receipt && isStonkDirectQuote(receipt.signed_quote)) return recoverStonkLaunch(paymentSignature, receipt);
    const data = await this.call(`/launches/${encodeURIComponent(paymentSignature)}`);
    const normalized = this.normalizeSubmitted(data);
    return { ...normalized, status: normalized.status };
  }

  private normalizeSubmitted(data: Record<string, unknown>): SubmittedLaunch {
    const status = data.status;
    if (!["processing", "completed", "failed"].includes(String(status))) {
      throw new StonkFunApiError("invalid_response", "StonkFun returned an unknown launch status. Check the payment before retrying.", 502, false);
    }
    if (status === "completed" && (!stringValue(data.mint) || !(stringValue(data.pool) ?? stringValue(data.poolAddress) ?? stringValue(data.address)))) {
      throw new StonkFunApiError("invalid_response", "StonkFun has not returned the completed mint and pool. Check status before retrying.", 502, true);
    }
    return {
      status: status as SubmittedLaunch["status"],
      paymentSignature: String(data.paymentSignature ?? data.payment_signature ?? ""),
      mint: stringValue(data.mint),
      pool: stringValue(data.pool) ?? stringValue(data.poolAddress) ?? stringValue(data.address),
      signature: stringValue(data.signature) ?? stringValue(data.launchSignature),
      raw: data,
    };
  }

  async getPair(mint: string): Promise<VenuePair | null> {
    const pairs = await this.listPairs();
    return pairs.find((pair) => pair.mint === mint) ?? null;
  }

  async listPairs(): Promise<VenuePair[]> {
    const data = await this.call("/pairs?launchable=true&launchLabReady=true");
    const pairs = Array.isArray(data.pairs) ? data.pairs as Record<string, unknown>[] : [];
    return pairs.map((item) => ({
      mint: String(item.mint), symbol: String(item.symbol), name: String(item.name),
      decimals: Number(item.decimals ?? 0), launchable: item.launchable !== false,
      launchLabReady: item.launchLabReady === undefined ? undefined : Boolean(item.launchLabReady),
    })).filter((item) => item.mint && item.symbol && Number.isInteger(item.decimals) && item.decimals >= 0 && item.decimals <= 18);
  }

  async getCreatorFees(mint: string): Promise<CreatorFees> {
    const data = await this.call(`/tokens/${encodeURIComponent(mint)}/fees`);
    let forwarding: CreatorFees["forwarding"], forwardingError: string | undefined;
    // Read the same public summary as Stonk's creator UI. These are diagnostic
    // venue balances, NEVER a funding credit or a per-token payment receipt.
    if (typeof data.creator === "string" && isAddress(data.creator) && data.claimable === null) {
      try {
        const url = new URL("/api/creator-fees", this.baseUrl);
        url.searchParams.set("mint", mint); url.searchParams.set("wallet", data.creator);
        const response = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`Stonk forwarding summary returned HTTP ${response.status}`);
        const atoms = z.string().regex(/^(0|[1-9][0-9]*)$/);
        const summary = z.object({ eligible: z.literal(true), creator: z.literal(data.creator), payout: z.object({
          mode: z.literal("forwarded"), quoteMint: z.string().refine(isAddress), quoteSymbol: z.string().min(1).max(32), decimals: z.number().int().min(0).max(18),
          accruedRaw: atoms, forwardedRaw: atoms, pendingRaw: atoms, minForwardUsd: z.number().finite().nonnegative(),
          lastSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/).optional(),
        }) }).parse(await response.json());
        const p = summary.payout;
        forwarding = { quoteMint: p.quoteMint, quoteSymbol: p.quoteSymbol, decimals: p.decimals,
          tokenAccruedAtoms: p.accruedRaw, creatorQuoteForwardedAtoms: p.forwardedRaw, creatorQuotePendingAtoms: p.pendingRaw,
          minimumForwardUsd: p.minForwardUsd, lastSignature: p.lastSignature, attribution: "creator_quote_aggregate_not_launch_funding" };
      } catch { forwardingError = "Stonk forwarding threshold and aggregate balance could not be verified. No reward funding was inferred."; }
    }
    return {
      claimable: data.claimable && typeof data.claimable === "object" ? data.claimable as Record<string, unknown> : null,
      reason: stringValue(data.reason), scope: stringValue(data.scope), raw: data, forwarding, forwardingError,
    };
  }

  async getMarketData(mint: string, expectedPool: string): Promise<VenueMarketData> {
    const data = await this.call(`/tokens/${encodeURIComponent(mint)}`);
    const token = data.token as Record<string, unknown> | undefined;
    if (!token || token.mint !== mint || token.pool !== expectedPool) throw new Error("StonkFun market identity does not match the registered launch");
    const market = token.market as Record<string, unknown> | undefined;
    const metric = (name: string) => typeof market?.[name] === "number" && Number.isFinite(market[name]) && Number(market[name]) >= 0 ? Number(market[name]) : null;
    return { priceUsd: metric("priceUsd"), marketCapUsd: metric("marketCapUsd"), volume24hUsd: metric("volume24hUsd"), liquidityUsd: metric("liquidityUsd"), raw: data };
  }

  async prepareCreatorFeeClaim(mint: string, creatorWallet: string): Promise<PreparedFeeClaim> {
    const data = await this.call(`/tokens/${encodeURIComponent(mint)}/fees/claim/prepare`, {
      method: "POST", body: JSON.stringify({ creatorWallet }),
    });
    return {
      intentId: String(data.intentId ?? ""), transaction: String(data.transaction ?? ""),
      expiresAt: stringValue(data.expiresAt), raw: data,
    };
  }

  async claimCreatorFees(input: { mint: string; creatorWallet: string; intentId: string; signedTransaction: string }) {
    const data = await this.call(`/tokens/${encodeURIComponent(input.mint)}/fees/claim/submit`, {
      method: "POST",
      body: JSON.stringify({ creatorWallet: input.creatorWallet, intentId: input.intentId, signedTransaction: input.signedTransaction }),
    });
    return { signature: String(data.signature ?? ""), alreadySubmitted: Boolean(data.alreadySubmitted), raw: data };
  }
}
