export interface RenderSellerPayload {
  readonly name: string;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly marketplaceProfileUrl?: string | null | undefined;
  readonly marketplaceIdentifier: string;
  readonly marketplaceSource: string;
  readonly sourceCaptureId: string;
  readonly sourceTenantId: string;
}

const assertNonEmpty = (value: string, field: string): void => { if (value.trim().length === 0) throw new RenderSellerConnectorError(`${field} is required`); };
const validatePayload = (payload: RenderSellerPayload): RenderSellerPayload => {
  assertNonEmpty(payload.name, "name");
  assertNonEmpty(payload.marketplaceIdentifier, "marketplaceIdentifier");
  assertNonEmpty(payload.marketplaceSource, "marketplaceSource");
  assertNonEmpty(payload.sourceCaptureId, "sourceCaptureId");
  assertNonEmpty(payload.sourceTenantId, "sourceTenantId");
  if (payload.email != null && !payload.email.includes("@")) throw new RenderSellerConnectorError("email must be valid");
  return payload;
};

export interface CreateRenderSellerInput extends RenderSellerPayload {
  readonly idempotencyKey: string;
}

export interface CreateRenderSellerResult {
  readonly renderSellerId: string;
  readonly status: "CREATED" | "EXISTS";
  readonly rawResponse?: unknown;
}

export interface RenderSellerConnector {
  createRenderSeller(input: CreateRenderSellerInput): Promise<CreateRenderSellerResult>;
}

export interface RenderSellerHttpConnectorOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
}


export class RenderSellerConnectorError extends Error {
  readonly statusCode?: number | undefined;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "RenderSellerConnectorError";
    this.statusCode = statusCode;
  }
}

export class RenderSellerHttpConnector implements RenderSellerConnector {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RenderSellerHttpConnectorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createRenderSeller(input: CreateRenderSellerInput): Promise<CreateRenderSellerResult> {
    const payload = validatePayload(input);
    const response = await this.fetchImpl(`${this.baseUrl}/seller-accounts`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.json().catch(() => ({} as unknown));
    if (!response.ok) {
      throw new RenderSellerConnectorError("Render seller API request failed", response.status);
    }

    const parsed = typeof raw === "object" && raw !== null ? raw as { readonly renderSellerId?: unknown; readonly id?: unknown; readonly status?: unknown } : {};
    const renderSellerId = typeof parsed.renderSellerId === "string" ? parsed.renderSellerId : typeof parsed.id === "string" ? parsed.id : undefined;
    if (renderSellerId === undefined) {
      throw new RenderSellerConnectorError("Render seller API response did not include a seller id");
    }

    const status = parsed.status === "EXISTS" ? "EXISTS" : parsed.status === "CREATED" ? "CREATED" : response.status === 200 ? "EXISTS" : "CREATED";
    return { renderSellerId, status, rawResponse: raw };
  }
}

export const createRenderSellerConnectorFromEnv = (env: NodeJS.ProcessEnv = process.env): RenderSellerHttpConnector => {
  const baseUrl = env.RENDER_API_BASE_URL;
  const apiKey = env.RENDER_API_KEY;
  if (baseUrl === undefined || baseUrl.trim().length === 0) throw new RenderSellerConnectorError("RENDER_API_BASE_URL is required");
  if (apiKey === undefined || apiKey.trim().length === 0) throw new RenderSellerConnectorError("RENDER_API_KEY is required");
  return new RenderSellerHttpConnector({ baseUrl, apiKey });
};
