import assert from "node:assert/strict";
import test from "node:test";

import {
  checkInvitationProviderHealth,
  createMessagingProviderRegistryFromEnv,
  validateClaimBaseUrl,
  buildClaimUrl,
} from "../dist/index.js";

const validEnv = {
  SELLER_INVITATION_BASE_URL: "https://app.example/claim",
  META_WHATSAPP_ACCESS_TOKEN: "super-secret-token",
  META_WHATSAPP_PHONE_NUMBER_ID: "phone-id",
  SELLER_INVITATION_SMS_API_URL: "https://sms.test/send",
  SELLER_INVITATION_SMS_API_KEY: "sms-secret-key",
  SELLER_INVITATION_SMS_SENDER_ID: "WhispeRM",
  RESEND_API_KEY: "resend-secret-key",
};

const registryFor = (env) => createMessagingProviderRegistryFromEnv({ env });

test("checkInvitationProviderHealth succeeds when required config exists", () => {
  const health = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(validEnv), env: validEnv });
  assert.equal(health.ok, true);
  assert.equal(health.provider, "meta_whatsapp");
  assert.equal(health.channel, "whatsapp");
  assert.equal(health.claimBaseUrl, "https://app.example/claim");
  assert.deepEqual(health.diagnostics.requiredEnvPresent, ["META_WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_PHONE_NUMBER_ID"]);
});

test("checkInvitationProviderHealth succeeds for email and sms channels", () => {
  const registry = registryFor(validEnv);
  const email = checkInvitationProviderHealth({ channel: "EMAIL", registry, env: validEnv });
  const sms = checkInvitationProviderHealth({ channel: "SMS", registry, env: validEnv });
  assert.equal(email.ok, true);
  assert.equal(email.provider, "email");
  assert.equal(sms.ok, true);
  assert.equal(sms.provider, "twilio_sms");
});

test("fails with MISSING_REQUIRED_ENV when required provider env is missing", () => {
  const env = { ...validEnv, META_WHATSAPP_ACCESS_TOKEN: undefined };
  const health = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(env), env });
  assert.equal(health.ok, false);
  assert.equal(health.code, "MISSING_REQUIRED_ENV");
  assert.deepEqual(health.diagnostics.missingEnv, ["META_WHATSAPP_ACCESS_TOKEN"]);
});

test("fails with INVALID_CLAIM_BASE_URL when the claim base url is missing", () => {
  const env = { ...validEnv, SELLER_INVITATION_BASE_URL: undefined };
  const health = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(env), env });
  assert.equal(health.ok, false);
  assert.equal(health.code, "INVALID_CLAIM_BASE_URL");
});

test("fails with INVALID_CLAIM_BASE_URL before reporting a channel-specific failure", () => {
  const env = { ...validEnv, SELLER_INVITATION_BASE_URL: "not-a-url", META_WHATSAPP_ACCESS_TOKEN: undefined };
  const health = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(env), env });
  assert.equal(health.ok, false);
  assert.equal(health.code, "INVALID_CLAIM_BASE_URL");
});

test("fails with INVALID_TEMPLATE_CONFIGURATION when the WhatsApp template is misconfigured", () => {
  const env = { ...validEnv, WHATSAPP_TEMPLATE_BODY_PARAM_COUNT: "3" };
  const health = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(env), env });
  assert.equal(health.ok, false);
  assert.equal(health.code, "INVALID_TEMPLATE_CONFIGURATION");
});

test("never exposes secret values in ok or failure diagnostics", () => {
  const okHealth = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(validEnv), env: validEnv });
  const serialized = JSON.stringify(okHealth);
  assert.doesNotMatch(serialized, /super-secret-token/u);

  const failEnv = { ...validEnv, META_WHATSAPP_ACCESS_TOKEN: undefined };
  const failHealth = checkInvitationProviderHealth({ channel: "WHATSAPP", registry: registryFor(failEnv), env: failEnv });
  assert.doesNotMatch(JSON.stringify(failHealth), /super-secret-token|sms-secret-key|resend-secret-key/u);
});

test("validateClaimBaseUrl accepts localhost, rejects empty/relative/malformed/placeholder", () => {
  assert.equal(validateClaimBaseUrl("http://localhost:3000/claim").ok, true);
  assert.equal(validateClaimBaseUrl("https://preview-123.vercel.app/claim").ok, true);
  assert.equal(validateClaimBaseUrl("https://app.whisperm.ai/claim").ok, true);
  assert.equal(validateClaimBaseUrl(undefined).ok, false);
  assert.equal(validateClaimBaseUrl("").ok, false);
  assert.equal(validateClaimBaseUrl("/claim").ok, false);
  assert.equal(validateClaimBaseUrl("not a url").ok, false);
  assert.equal(validateClaimBaseUrl("https://example.com").ok, false);
  assert.equal(validateClaimBaseUrl("https://app.changeme.com/claim").ok, false);
  assert.equal(validateClaimBaseUrl("https://TODO.example/claim").ok, false);
  assert.equal(validateClaimBaseUrl("ftp://app.example/claim").ok, false);
});

test("buildClaimUrl joins a validated base url with a raw claim token", () => {
  const url = buildClaimUrl("https://app.example/claim", "raw-token-123");
  assert.equal(url, "https://app.example/claim/raw-token-123");
  const trailingSlash = buildClaimUrl("https://app.example/claim/", "raw-token-123");
  assert.equal(trailingSlash, "https://app.example/claim/raw-token-123");
});
