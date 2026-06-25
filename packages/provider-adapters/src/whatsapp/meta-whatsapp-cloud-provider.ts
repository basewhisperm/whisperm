import type { WhatsAppMessage, WhatsAppProvider } from "../email/resend-provider.js";

export interface MetaWhatsAppCloudProviderOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly templateName?: string | undefined;
  readonly templateLanguage?: string | undefined;
  readonly graphApiVersion?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export class MetaWhatsAppCloudProvider implements WhatsAppProvider {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly templateName: string;
  private readonly templateLanguage: string;
  private readonly graphApiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaWhatsAppCloudProviderOptions) {
    this.accessToken = options.accessToken.trim();
    this.phoneNumberId = options.phoneNumberId.trim();
    this.templateName = options.templateName?.trim() || "seller_invitation_v1";
    this.templateLanguage = options.templateLanguage?.trim() || "en";
    this.graphApiVersion = options.graphApiVersion?.trim() || "v20.0";
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (this.accessToken.length === 0) throw new Error("META_WHATSAPP_ACCESS_TOKEN is required");
    if (this.phoneNumberId.length === 0) throw new Error("META_WHATSAPP_PHONE_NUMBER_ID is required");
  }

  async send(message: WhatsAppMessage): Promise<void> {
    const to = message.to.replace(/[^\d]/gu, "");
    if (to.length === 0) throw new Error("WhatsApp recipient phone is required");

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
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: message.body }],
              },
            ],
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`WhatsApp Cloud API failed with ${response.status}: ${"provider response redacted"}`);
    }
  }
}

export const createMetaWhatsAppCloudProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): MetaWhatsAppCloudProvider | undefined => {
  const accessToken = env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? env.WHATSAPP_CLOUD_API_TOKEN?.trim();
  const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim();

  if (!accessToken || !phoneNumberId) return undefined;

  return new MetaWhatsAppCloudProvider({
    accessToken,
    phoneNumberId,
    templateName: env.WHATSAPP_CLOUD_TEMPLATE_NAME,
    templateLanguage: env.WHATSAPP_CLOUD_TEMPLATE_LANGUAGE,
    graphApiVersion: env.WHATSAPP_CLOUD_GRAPH_API_VERSION,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
};
