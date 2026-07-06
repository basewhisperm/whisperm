import { createResendEmailProviderFromEnv } from "./email/resend-provider.js";
import { createHttpSmsProviderFromEnv } from "./sms/http-sms-provider.js";
import { createMetaWhatsAppCloudProviderFromEnv } from "./whatsapp/meta-whatsapp-cloud-provider.js";
import type { EmailProvider, SmsProvider, WhatsAppProvider } from "./email/resend-provider.js";

/**
 * ST1-013: canonical messaging provider registry. WhatsApp/SMS/Email are external, optional
 * capabilities configured from process environment at boot -- this is the single place that
 * constructs them, so apps/api (via apps/web routes) and apps/worker never instantiate a
 * provider independently and can never disagree about whether one is available.
 */
export const messagingProviderIds = ["WHATSAPP", "SMS", "EMAIL"] as const;
export type MessagingProviderId = (typeof messagingProviderIds)[number];

export const providerLifecycleStateValues = ["UNCONFIGURED", "INITIALIZING", "READY", "FAILED"] as const;
export type ProviderLifecycleState = (typeof providerLifecycleStateValues)[number];

export const providerInitializationFailureCategoryValues = [
  "MISSING_CONFIGURATION",
  "AUTHENTICATION_FAILURE",
  "NETWORK_FAILURE",
  "UNKNOWN",
] as const;
export type ProviderInitializationFailureCategory = (typeof providerInitializationFailureCategoryValues)[number];

export interface ProviderInitializationFailure {
  readonly category: ProviderInitializationFailureCategory;
  readonly message: string;
}

export interface MessagingProviderHealth {
  readonly provider: MessagingProviderId;
  readonly state: ProviderLifecycleState;
  readonly configured: boolean;
  readonly initialized: boolean;
  readonly healthy: boolean;
  readonly failureReason: ProviderInitializationFailure | null;
  readonly lastInitializationAt: string;
}

export interface MessagingProviderStructuredLogger {
  info(message: string, attributes: Readonly<Record<string, unknown>>): void;
  warn(message: string, attributes: Readonly<Record<string, unknown>>): void;
  error(message: string, attributes: Readonly<Record<string, unknown>>): void;
}

export const createConsoleMessagingProviderLogger = (): MessagingProviderStructuredLogger => ({
  info: (message, attributes) => console.info(JSON.stringify({ level: "info", message, ...attributes })),
  warn: (message, attributes) => console.warn(JSON.stringify({ level: "warn", message, ...attributes })),
  error: (message, attributes) => console.error(JSON.stringify({ level: "error", message, ...attributes })),
});

const noopMessagingProviderLogger: MessagingProviderStructuredLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const classifyInitializationFailure = (error: unknown): ProviderInitializationFailure => {
  const message = error instanceof Error ? error.message : "Provider initialization failed for an unknown reason";
  if (/required|missing/iu.test(message)) {
    return { category: "MISSING_CONFIGURATION", message };
  }
  if (/auth|token|credential|unauthorized|forbidden/iu.test(message)) {
    return { category: "AUTHENTICATION_FAILURE", message };
  }
  if (/network|fetch|econnrefused|enotfound|timeout|dns/iu.test(message)) {
    return { category: "NETWORK_FAILURE", message };
  }
  return { category: "UNKNOWN", message };
};

/**
 * Holds one provider through its UNCONFIGURED -> INITIALIZING -> READY|FAILED lifecycle.
 * `factory` is expected to be synchronous and side-effect-free beyond reading env and
 * constructing a client object (no network calls at construction time), so this never blocks
 * process startup and can never leave the process half-initialized.
 */
class MessagingProviderSlot<T> {
  private readonly id: MessagingProviderId;
  private readonly logger: MessagingProviderStructuredLogger;
  private state: ProviderLifecycleState;
  private instance: T | undefined;
  private failure: ProviderInitializationFailure | null = null;
  private readonly initializedAt: string;

  constructor(id: MessagingProviderId, factory: () => T | undefined, now: () => Date, logger: MessagingProviderStructuredLogger) {
    this.id = id;
    this.logger = logger;
    this.state = "INITIALIZING";
    try {
      this.instance = factory();
      this.state = this.instance === undefined ? "UNCONFIGURED" : "READY";
    } catch (error) {
      this.failure = classifyInitializationFailure(error);
      this.state = "FAILED";
    }
    this.initializedAt = now().toISOString();
    this.logInitializationOutcome();
  }

  private logInitializationOutcome(): void {
    const attributes = {
      provider: this.id,
      state: this.state,
      configured: this.state !== "UNCONFIGURED",
      lastInitializationAt: this.initializedAt,
      ...(this.failure === null ? {} : { failureCategory: this.failure.category, failureReason: this.failure.message }),
    };
    if (this.state === "FAILED") {
      this.logger.error("provider initialization failed; capability is unavailable and runtime continues", attributes);
    } else if (this.state === "UNCONFIGURED") {
      this.logger.warn("provider is unconfigured; capability disabled, runtime continues", attributes);
    } else {
      this.logger.info("provider initialized", attributes);
    }
  }

  getInstance(): T | undefined {
    return this.instance;
  }

  isAvailable(): boolean {
    return this.state === "READY";
  }

  health(): MessagingProviderHealth {
    return {
      provider: this.id,
      state: this.state,
      configured: this.state !== "UNCONFIGURED",
      initialized: this.state === "READY",
      healthy: this.state === "READY",
      failureReason: this.failure,
      lastInitializationAt: this.initializedAt,
    };
  }
}

export interface MessagingProviderRegistryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: MessagingProviderStructuredLogger;
  readonly now?: () => Date;
}

/**
 * Canonical provider registry: constructs WhatsApp/SMS/Email exactly once per instance and
 * exposes their capability + health. `createMessagingProviderRegistryFromEnv` is the only
 * sanctioned way to build one -- apps/api and apps/worker both call it instead of touching the
 * individual `create*FromEnv` factories directly.
 */
export class MessagingProviderRegistry {
  private readonly whatsappSlot: MessagingProviderSlot<WhatsAppProvider>;
  private readonly smsSlot: MessagingProviderSlot<SmsProvider>;
  private readonly emailSlot: MessagingProviderSlot<EmailProvider>;

  constructor(options: MessagingProviderRegistryOptions = {}) {
    const env = options.env ?? process.env;
    const fetchImpl = options.fetchImpl;
    const logger = options.logger ?? noopMessagingProviderLogger;
    const now = options.now ?? ((): Date => new Date());

    this.whatsappSlot = new MessagingProviderSlot("WHATSAPP", () => createMetaWhatsAppCloudProviderFromEnv(env, fetchImpl), now, logger);
    this.smsSlot = new MessagingProviderSlot("SMS", () => createHttpSmsProviderFromEnv(env, fetchImpl), now, logger);
    this.emailSlot = new MessagingProviderSlot("EMAIL", () => createResendEmailProviderFromEnv(env), now, logger);
  }

  getWhatsAppProvider(): WhatsAppProvider | undefined {
    return this.whatsappSlot.getInstance();
  }

  getSmsProvider(): SmsProvider | undefined {
    return this.smsSlot.getInstance();
  }

  getEmailProvider(): EmailProvider | undefined {
    return this.emailSlot.getInstance();
  }

  isAvailable(provider: MessagingProviderId): boolean {
    if (provider === "WHATSAPP") return this.whatsappSlot.isAvailable();
    if (provider === "SMS") return this.smsSlot.isAvailable();
    return this.emailSlot.isAvailable();
  }

  health(): readonly MessagingProviderHealth[] {
    return [this.whatsappSlot.health(), this.smsSlot.health(), this.emailSlot.health()];
  }
}

export const createMessagingProviderRegistryFromEnv = (
  options: MessagingProviderRegistryOptions = {},
): MessagingProviderRegistry => new MessagingProviderRegistry(options);

export interface SellerInvitationNotificationPorts {
  readonly whatsapp?: WhatsAppProvider | undefined;
  readonly sms?: SmsProvider | undefined;
  readonly email?: EmailProvider | undefined;
  readonly whatsappEnabled: boolean;
  readonly fallbackToSmsWhenWhatsappMissing: boolean;
  readonly inviteBaseUrl: string | undefined;
}

/**
 * Canonical wiring from a MessagingProviderRegistry into the shape SellerInvitationService
 * expects. Previously apps/web and apps/worker each hand-built this object from their own
 * direct `create*FromEnv` calls; both now go through this single function so a capability
 * check anywhere downstream reflects the same registry, not two independently-initialized
 * copies of the same providers.
 */
export const buildSellerInvitationNotificationPorts = (
  registry: MessagingProviderRegistry,
  env: NodeJS.ProcessEnv = process.env,
): SellerInvitationNotificationPorts => {
  const whatsapp = registry.getWhatsAppProvider();
  const sms = registry.getSmsProvider();
  const email = registry.getEmailProvider();
  return {
    whatsappEnabled: env.SELLER_INVITATION_WHATSAPP_ENABLED !== "false",
    fallbackToSmsWhenWhatsappMissing: env.SELLER_INVITATION_FALLBACK_TO_SMS !== "false",
    inviteBaseUrl: env.SELLER_INVITATION_BASE_URL,
    ...(whatsapp === undefined ? {} : { whatsapp }),
    ...(sms === undefined ? {} : { sms }),
    ...(email === undefined ? {} : { email }),
  };
};
