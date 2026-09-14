import type {
  CreatorFees,
  LaunchVenueAdapter,
  PreparedFeeClaim,
  PreparedLaunch,
  SubmittedLaunch,
  VenueLaunch,
  VenuePair,
} from "@/lib/venue/launch-venue-adapter";
import type { LaunchDraft } from "@/lib/types";

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
        Boolean(error.retryable) || response.status >= 500,
        body as Record<string, unknown>,
      );
    }
    return body.data ?? {};
  }

  async createLaunch(input: LaunchDraft): Promise<PreparedLaunch> {
    const data = await this.call("/launches/prepare", {
      method: "POST",
      body: JSON.stringify({
        creatorWallet: input.creatorWallet,
        quoteMint: input.quoteMint,
        name: input.name,
        symbol: input.symbol,
        logo: input.logo,
        mode: "standard",
        feeTier: input.feeTier,
        website: input.website,
        twitter: input.twitter,
        telegram: input.telegram,
      }),
    });
    return {
      signedQuote: String(data.signedQuote ?? ""),
      paymentTransaction: String(data.paymentTransaction ?? ""),
      payment: (data.payment ?? {}) as PreparedLaunch["payment"],
      raw: data,
    };
  }

  async submitLaunch(input: { signedQuote: string; signedTransaction: string; logo: string }): Promise<SubmittedLaunch> {
    const data = await this.call("/launches/submit", { method: "POST", body: JSON.stringify(input) });
    return this.normalizeSubmitted(data);
  }

  async getLaunch(paymentSignature: string): Promise<VenueLaunch> {
    const data = await this.call(`/launches/${encodeURIComponent(paymentSignature)}`);
    const normalized = this.normalizeSubmitted(data);
    return { ...normalized, status: normalized.status };
  }

  private normalizeSubmitted(data: Record<string, unknown>): SubmittedLaunch {
    const status = data.status === "processing" ? "processing" : "completed";
    return {
      status,
      paymentSignature: String(data.paymentSignature ?? data.payment_signature ?? ""),
      mint: stringValue(data.mint),
      pool: stringValue(data.pool) ?? stringValue(data.poolAddress) ?? stringValue(data.address),
      signature: stringValue(data.signature) ?? stringValue(data.launchSignature),
      raw: data,
    };
  }

  async getPair(mint: string): Promise<VenuePair | null> {
    const data = await this.call("/pairs?launchable=true&launchLabReady=true");
    const pairs = Array.isArray(data.pairs) ? data.pairs as Record<string, unknown>[] : [];
    const item = pairs.find((pair) => pair.mint === mint);
    if (!item) return null;
    return {
      mint: String(item.mint), symbol: String(item.symbol), name: String(item.name),
      decimals: Number(item.decimals ?? 0), launchable: item.launchable !== false,
      launchLabReady: item.launchLabReady === undefined ? undefined : Boolean(item.launchLabReady),
    };
  }

  async getCreatorFees(mint: string): Promise<CreatorFees> {
    const data = await this.call(`/tokens/${encodeURIComponent(mint)}/fees`);
    return {
      claimable: data.claimable && typeof data.claimable === "object" ? data.claimable as Record<string, unknown> : null,
      reason: stringValue(data.reason), scope: stringValue(data.scope), raw: data,
    };
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
