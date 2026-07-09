import type { WhatsAppMessage, WhatsAppProvider } from "../email/resend-provider.js";
import { ProviderDeliveryError } from "../provider-delivery-error.js";

export interface MetaWhatsAppCloudProviderOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly templateName?: string | undefined;
  readonly templateLanguage?: string | undefined;
  /**
   * ST1-013J: Meta rejects a template send whose parameter list doesn't match the approved
   * template exactly, so this must be explicit rather than inferred from whether `message.body`
   * happens to be truthy. `0` sends the template with no body component; `1` sends exactly one
   * body parameter (the historical default, kept for backward compatibility). Anything else means
   * this adapter does not know how to map body text onto the template's parameters, so
   * construction fails closed instead of guessing.
   */
  readonly templateBodyParamCount?: number | undefined;
  readonly graphApiVersion?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

const SUPPORTED_TEMPLATE_BODY_PARAM_COUNTS = new Set([0, 1]);

export class MetaWhatsAppCloudProvider implements WhatsAppProvider {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly templateName: string;
  private readonly templateLanguage: string;
  private readonly templateBodyParamCount: number;
  private readonly graphApiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaWhatsAppCloudProviderOptions) {
    this.accessToken = options.accessToken.trim();
    this.phoneNumberId = options.phoneNumberId.trim();
    this.templateName = options.templateName?.trim() || "seller_invitation_v1";
    this.templateLanguage = options.templateLanguage?.trim() || "en";
    this.templateBodyParamCount = options.templateBodyParamCount ?? 1;
    this.graphApiVersion = options.graphApiVersion?.trim() || "v20.0";
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (this.accessToken.length === 0) throw new Error("META_WHATSAPP_ACCESS_TOKEN is required");
    if (this.phoneNumberId.length === 0) throw new Error("META_WHATSAPP_PHONE_NUMBER_ID is required");
    if (this.templateName.length === 0) throw new Error("WHATSAPP_TEMPLATE_NAME is required");
    if (this.templateLanguage.length === 0) throw new Error("WHATSAPP_TEMPLATE_LANGUAGE is required");
    if (!Number.isInteger(this.templateBodyParamCount) || this.templateBodyParamCount < 0) {
      throw new Error("WHATSAPP_TEMPLATE_BODY_PARAM_COUNT template configuration is invalid: must be a non-negative integer");
    }
    if (!SUPPORTED_TEMPLATE_BODY_PARAM_COUNTS.has(this.templateBodyParamCount)) {
      throw new Error(
        `WHATSAPP_TEMPLATE_BODY_PARAM_COUNT template configuration is invalid: templates with ${this.templateBodyParamCount} body parameters are not supported without an explicit parameter mapping`,
      );
    }
  }

  /** Safe (no secrets) description of the resolved template configuration, for health/diagnostics. */
  describeTemplateConfig(): { readonly templateName: string; readonly templateLanguage: string; readonly templateBodyParamCount: number } {
    return { templateName: this.templateName, templateLanguage: this.templateLanguage, templateBodyParamCount: this.templateBodyParamCount };
  }

  async send(message: WhatsAppMessage): Promise<void> {
    const to = message.to.startsWith("+") ? message.to.replace(/[^\d+]/gu, "") : message.to.replace(/[^\d]/gu, "");
    if (to.length === 0) throw new Error("WhatsApp recipient phone is required");

    const components = this.templateBodyParamCount === 0
      ? []
      : [{ type: "body", parameters: [{ type: "text", text: message.body }] }];

    const response = await this.fetchImpl(
      `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: this.templateName,
            language: { code: this.templateLanguage },
            components,
          },
        }),
      },
    );

    if (!response.ok) {
      throw await this.toDeliveryError(response);
    }
  }

  /**
   * Meta's error envelope (`{ error: { message, type, code, error_subcode, fbtrace_id } }`) can
   * echo request content back in `message`, so only `type`/`code`/`fbtrace_id` are ever lifted
   * out -- never the raw body and never `message`.
   */
  private async toDeliveryError(response: Response): Promise<ProviderDeliveryError> {
    const bodyText = await response.text().catch(() => "");
    let safeCode: string | undefined;
    let safeCategory: string | undefined;
    let requestId: string | undefined;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      const error = typeof parsed === "object" && parsed !== null ? (parsed as { error?: unknown }).error : undefined;
      if (typeof error === "object" && error !== null) {
        const errorRecord = error as Record<string, unknown>;
        if (typeof errorRecord.code === "number" || typeof errorRecord.code === "string") safeCode = String(errorRecord.code);
        if (typeof errorRecord.type === "string") safeCategory = errorRecord.type;
        if (typeof errorRecord.fbtrace_id === "string") requestId = errorRecord.fbtrace_id;
      }
    } catch {
      // Provider returned a non-JSON or unexpected body; no safe fields to lift out.
    }

    return new ProviderDeliveryError({
      message: `WhatsApp Cloud API rejected the request (status ${response.status})`,
      provider: "meta_whatsapp",
      status: response.status,
      safeCode,
      safeCategory,
      requestId,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
}

const parseTemplateBodyParamCount = (raw: string | undefined): number | undefined => {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const createMetaWhatsAppCloudProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): MetaWhatsAppCloudProvider | undefined => {
  const accessToken = env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? env.WHATSAPP_CLOUD_API_TOKEN?.trim();
  const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim();

  if (!accessToken || !phoneNumberId) return undefined;

  const templateBodyParamCount = parseTemplateBodyParamCount(
    env.WHATSAPP_TEMPLATE_BODY_PARAM_COUNT ?? env.WHATSAPP_CLOUD_TEMPLATE_BODY_PARAM_COUNT,
  );

  return new MetaWhatsAppCloudProvider({
    accessToken,
    phoneNumberId,
    templateName: env.WHATSAPP_TEMPLATE_NAME ?? env.WHATSAPP_CLOUD_TEMPLATE_NAME,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE ?? env.WHATSAPP_CLOUD_TEMPLATE_LANGUAGE,
    ...(templateBodyParamCount === undefined ? {} : { templateBodyParamCount }),
    graphApiVersion: env.WHATSAPP_CLOUD_GRAPH_API_VERSION,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
};
