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

/**
 * ST1-012: SMS is an optional provider, same as WhatsApp -- missing config must degrade the SMS
 * channel only, not crash the process constructing this port. Returns `undefined` (instead of
 * constructing an HttpSmsProvider that would throw on first use, or previously throwing here
 * synchronously) whenever the required env vars aren't set.
 */
export const createHttpSmsProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): HttpSmsProvider | undefined => {
  const apiUrl = env.SELLER_INVITATION_SMS_API_URL?.trim();
  const apiKey = env.SELLER_INVITATION_SMS_API_KEY?.trim();
  const senderId = env.SELLER_INVITATION_SMS_SENDER_ID?.trim();
  if (!apiUrl || !apiKey || !senderId) return undefined;

  return new HttpSmsProvider({
    providerName: env.SELLER_INVITATION_SMS_PROVIDER,
    apiUrl,
    apiKey,
    senderId,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
};
