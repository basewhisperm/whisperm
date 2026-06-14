import { Resend } from "resend";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export interface SmsMessage { readonly to: string; readonly body: string; }
export interface SmsProvider { send(message: SmsMessage): Promise<void>; }
export interface WhatsAppMessage { readonly to: string; readonly body: string; }
export interface WhatsAppProvider { send(message: WhatsAppMessage): Promise<void>; }

export interface ResendEmailProviderOptions {
  readonly apiKey: string;
  readonly from: string;
}

export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  private readonly from: string;

  constructor(options: ResendEmailProviderOptions) {
    this.client = new Resend(options.apiKey);
    this.from = options.from;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
  }
}

export const createResendEmailProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): ResendEmailProvider => {
  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("RESEND_API_KEY is required");
  }

  return new ResendEmailProvider({
    apiKey,
    from: env.EMAIL_FROM ?? "WhispeRM <noreply@whisperm.ai>",
  });
};
