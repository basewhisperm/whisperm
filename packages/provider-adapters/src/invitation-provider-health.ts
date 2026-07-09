import type { MessagingProviderHealth, MessagingProviderId, MessagingProviderRegistry } from "./registry.js";

/**
 * ST1-013J: canonical provider health/preflight contract. Nothing that queues or executes a
 * seller invitation should decide whether that's safe by inspecting env vars or provider
 * instances directly -- everything (the eligibility check in apps/web, the
 * SellerInvitationService preflight, and the `/provider-health` diagnostic endpoint) goes through
 * `checkInvitationProviderHealth`/`validateClaimBaseUrl` so they can never disagree.
 *
 * Secrets never appear here: only env var *names*, provider names, and the claim URL origin are
 * ever included in a health result.
 */
export type InvitationProviderChannel = "whatsapp" | "sms" | "email" | "manual";
export type InvitationProviderId = "meta_whatsapp" | "twilio_sms" | "email" | "manual";

export type InvitationProviderHealthFailureCode =
  | "NO_PROVIDER_CONFIGURED"
  | "MISSING_REQUIRED_ENV"
  | "INVALID_CLAIM_BASE_URL"
  | "INVALID_TEMPLATE_CONFIGURATION"
  | "PROVIDER_INITIALIZATION_FAILED";

export type InvitationProviderHealth =
  | {
      readonly ok: true;
      readonly provider: InvitationProviderId;
      readonly channel: InvitationProviderChannel;
      readonly claimBaseUrl: string;
      readonly diagnostics: {
        readonly requiredEnvPresent: readonly string[];
        readonly optionalEnvMissing?: readonly string[] | undefined;
      };
    }
  | {
      readonly ok: false;
      readonly code: InvitationProviderHealthFailureCode;
      readonly message: string;
      readonly diagnostics?: {
        readonly missingEnv?: readonly string[] | undefined;
        readonly invalidEnv?: readonly string[] | undefined;
        readonly provider?: string | undefined;
      } | undefined;
    };

export type SellerInvitationChannelName = "WHATSAPP" | "SMS" | "EMAIL";

const channelMeta: Record<SellerInvitationChannelName, { readonly channel: InvitationProviderChannel; readonly provider: InvitationProviderId; readonly messagingProvider: MessagingProviderId }> = {
  WHATSAPP: { channel: "whatsapp", provider: "meta_whatsapp", messagingProvider: "WHATSAPP" },
  SMS: { channel: "sms", provider: "twilio_sms", messagingProvider: "SMS" },
  EMAIL: { channel: "email", provider: "email", messagingProvider: "EMAIL" },
};

const requiredEnvNamesByChannel: Record<SellerInvitationChannelName, readonly string[]> = {
  WHATSAPP: ["META_WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_PHONE_NUMBER_ID"],
  SMS: ["SELLER_INVITATION_SMS_API_URL", "SELLER_INVITATION_SMS_API_KEY", "SELLER_INVITATION_SMS_SENDER_ID"],
  EMAIL: ["RESEND_API_KEY"],
};

const optionalEnvNamesByChannel: Record<SellerInvitationChannelName, readonly string[]> = {
  WHATSAPP: ["WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANGUAGE", "WHATSAPP_TEMPLATE_BODY_PARAM_COUNT"],
  SMS: ["SELLER_INVITATION_SMS_PROVIDER"],
  EMAIL: ["EMAIL_FROM"],
};

const isEnvPresent = (env: NodeJS.ProcessEnv, name: string): boolean => {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
};

/** Legacy aliases accepted by the provider factories -- checked so diagnostics don't false-flag a var as missing when only the alias is set. */
const legacyAliases: Readonly<Record<string, string>> = {
  META_WHATSAPP_ACCESS_TOKEN: "WHATSAPP_CLOUD_API_TOKEN",
  META_WHATSAPP_PHONE_NUMBER_ID: "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  WHATSAPP_TEMPLATE_NAME: "WHATSAPP_CLOUD_TEMPLATE_NAME",
  WHATSAPP_TEMPLATE_LANGUAGE: "WHATSAPP_CLOUD_TEMPLATE_LANGUAGE",
  WHATSAPP_TEMPLATE_BODY_PARAM_COUNT: "WHATSAPP_CLOUD_TEMPLATE_BODY_PARAM_COUNT",
};

const isEnvPresentWithAlias = (env: NodeJS.ProcessEnv, name: string): boolean => {
  if (isEnvPresent(env, name)) return true;
  const alias = legacyAliases[name];
  return alias !== undefined && isEnvPresent(env, alias);
};

export type ClaimBaseUrlValidation =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

const PLACEHOLDER_TOKENS = ["changeme", "change-me", "todo", "your-domain", "yourdomain", "placeholder"];
const UNRESOLVED_TEMPLATE_PATTERN = /\{\{|\}\}|\$\{|<[a-z-]+>/iu;

/**
 * ST1-013J: `SELLER_INVITATION_BASE_URL` has no implicit default -- an unset/empty value is a
 * preflight failure, never a silent fall-through to a production domain. Accepts any explicit
 * absolute http(s) URL (localhost for local dev, a Vercel preview URL, or a production URL) as
 * long as it isn't empty, relative, malformed, or an obvious placeholder.
 */
export const validateClaimBaseUrl = (rawValue: string | undefined | null): ClaimBaseUrlValidation => {
  const trimmed = rawValue?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return { ok: false, reason: "SELLER_INVITATION_BASE_URL is not set" };
  }
  if (UNRESOLVED_TEMPLATE_PATTERN.test(trimmed)) {
    return { ok: false, reason: "SELLER_INVITATION_BASE_URL contains an unresolved placeholder" };
  }
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_TOKENS.some((token) => lower.includes(token)) || lower === "https://example.com" || lower === "https://www.example.com" || lower === "http://example.com") {
    return { ok: false, reason: "SELLER_INVITATION_BASE_URL looks like a placeholder value" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "SELLER_INVITATION_BASE_URL is not an absolute URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "SELLER_INVITATION_BASE_URL must use http or https" };
  }
  if (parsed.hostname.length === 0) {
    return { ok: false, reason: "SELLER_INVITATION_BASE_URL is missing a host" };
  }
  return { ok: true, url: trimmed };
};

/** Joins a validated claim base URL with a raw claim token and verifies the result parses as a usable URL. */
export const buildClaimUrl = (baseUrl: string, rawToken: string): string => {
  const url = `${baseUrl.replace(/\/$/u, "")}/${rawToken}`;
  // Throws if the join produced something unusable -- callers should only pass an already-validated baseUrl.
  new URL(url);
  return url;
};

const claimBaseUrlHealthFailure = (env: NodeJS.ProcessEnv): { readonly ok: false; readonly code: "INVALID_CLAIM_BASE_URL"; readonly message: string; readonly diagnostics: { readonly invalidEnv: readonly string[] } } | undefined => {
  const validation = validateClaimBaseUrl(env.SELLER_INVITATION_BASE_URL);
  if (validation.ok) return undefined;
  return {
    ok: false,
    code: "INVALID_CLAIM_BASE_URL",
    message: `Seller invitation claim link base URL is invalid: ${validation.reason}.`,
    diagnostics: { invalidEnv: ["SELLER_INVITATION_BASE_URL"] },
  };
};

const missingEnvNames = (env: NodeJS.ProcessEnv, names: readonly string[]): readonly string[] =>
  names.filter((name) => !isEnvPresentWithAlias(env, name));

export interface CheckInvitationProviderHealthInput {
  readonly channel: SellerInvitationChannelName;
  readonly registry: MessagingProviderRegistry;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

/**
 * Computes provider health for one invitation channel. Uses the same `MessagingProviderRegistry`
 * instance that `buildSellerInvitationNotificationPorts` wires into execution, so a health check
 * can never report "ready" for a provider that execution would fail to use (or vice versa).
 */
export const checkInvitationProviderHealth = (input: CheckInvitationProviderHealthInput): InvitationProviderHealth => {
  const env = input.env ?? process.env;
  const claimBaseUrlFailure = claimBaseUrlHealthFailure(env);
  if (claimBaseUrlFailure !== undefined) return claimBaseUrlFailure;

  const meta = channelMeta[input.channel];
  const providerHealthList: readonly MessagingProviderHealth[] = input.registry.health();
  const providerHealth = providerHealthList.find((entry) => entry.provider === meta.messagingProvider);

  if (providerHealth === undefined || providerHealth.state === "UNCONFIGURED") {
    return {
      ok: false,
      code: "MISSING_REQUIRED_ENV",
      message: `Invitation provider is missing required configuration for the ${meta.channel} channel.`,
      diagnostics: { missingEnv: missingEnvNames(env, requiredEnvNamesByChannel[input.channel]), provider: meta.provider },
    };
  }

  if (providerHealth.state === "FAILED") {
    const category = providerHealth.failureReason?.category;
    if (category === "TEMPLATE_CONFIGURATION_INVALID") {
      return {
        ok: false,
        code: "INVALID_TEMPLATE_CONFIGURATION",
        message: `Invitation provider template configuration is invalid for the ${meta.channel} channel.`,
        diagnostics: { provider: meta.provider },
      };
    }
    return {
      ok: false,
      code: "PROVIDER_INITIALIZATION_FAILED",
      message: `Invitation provider failed to initialize for the ${meta.channel} channel.`,
      diagnostics: { provider: meta.provider },
    };
  }

  const validation = validateClaimBaseUrl(env.SELLER_INVITATION_BASE_URL);
  if (!validation.ok) {
    // Unreachable in practice (checked above) but keeps the success branch's `claimBaseUrl` typed as a real string.
    return { ok: false, code: "INVALID_CLAIM_BASE_URL", message: "Seller invitation claim link base URL is invalid.", diagnostics: { invalidEnv: ["SELLER_INVITATION_BASE_URL"] } };
  }

  return {
    ok: true,
    provider: meta.provider,
    channel: meta.channel,
    claimBaseUrl: validation.url,
    diagnostics: {
      requiredEnvPresent: requiredEnvNamesByChannel[input.channel].filter((name) => isEnvPresentWithAlias(env, name)),
      optionalEnvMissing: optionalEnvNamesByChannel[input.channel].filter((name) => !isEnvPresentWithAlias(env, name)),
    },
  };
};
