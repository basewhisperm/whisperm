import type { SmsMessage, SmsProvider } from "../email/resend-provider.js";

export interface HttpSmsProviderOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly senderId: string;
  readonly providerName?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export class HttpSmsProvider implements SmsProvider {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly providerName: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpSmsProviderOptions) {
    const apiUrl = options.apiUrl.trim();
    const apiKey = options.apiKey.trim();
    const senderId = options.senderId.trim();
    if (apiUrl.length === 0) throw new Error("SELLER_INVITATION_SMS_API_URL is required");
    if (apiKey.length === 0) throw new Error("SELLER_INVITATION_SMS_API_KEY is required");
    if (senderId.length === 0) throw new Error("SELLER_INVITATION_SMS_SENDER_ID is required");
    this.apiUrl = new URL(apiUrl).toString();
    this.apiKey = apiKey;
    this.senderId = senderId;
    this.providerName = options.providerName?.trim() || "http";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: SmsMessage): Promise<void> {
    const response = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: this.providerName,
        from: this.senderId,
        to: message.to,
        body: message.body,
      }),
    });
    if (!response.ok) throw new Error("Seller invitation SMS provider failed");
  }
}

export const createHttpSmsProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): HttpSmsProvider => new HttpSmsProvider({
  providerName: env.SELLER_INVITATION_SMS_PROVIDER,
  apiUrl: env.SELLER_INVITATION_SMS_API_URL ?? "",
  apiKey: env.SELLER_INVITATION_SMS_API_KEY ?? "",
  senderId: env.SELLER_INVITATION_SMS_SENDER_ID ?? "",
  ...(fetchImpl === undefined ? {} : { fetchImpl }),
});
