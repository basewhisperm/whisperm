import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProviderCapability,
  assertProviderTenantIsolation,
  emailProviderContractSchema,
  linkedInProviderContractSchema,
  metaProviderContractSchema,
  normalizeEmbeddingResponse,
  normalizeProviderTextResponse,
  openAiCompatibleRequestSchema,
  anthropicCompatibleRequestSchema,
  parseProviderContract,
  providerAuthConfigSchema,
  providerDescriptorSchema,
  ProviderRuntimeError,
  webhookProviderContractSchema
} from "../dist/index.js";

const context = {
  tenantId: "tenant-1",
  providerId: "provider-openai-1",
  providerKind: "OPENAI",
  operation: "generate",
  correlationId: "corr-provider-1",
  actorId: "user-1",
  idempotencyKey: "tenant-1:generate:1"
};

const descriptor = {
  tenantId: "tenant-1",
  providerId: "provider-openai-1",
  kind: "OPENAI",
  domain: "AI",
  displayName: "OpenAI tenant adapter",
  enabled: true,
  capabilities: ["CHAT_COMPLETIONS", "TEXT_GENERATION", "STRUCTURED_OUTPUT"],
  auth: { scheme: "API_KEY", apiKey: { secretRef: "vault://tenant-1/openai/api-key" } },
  rateLimit: { requests: { limit: 60, intervalMs: 60_000 }, concurrency: 4 }
};

test("provider descriptors validate tenant-scoped capabilities and secret references only", () => {
  const parsed = providerDescriptorSchema.parse(descriptor);

  assert.equal(parsed.tenantId, "tenant-1");
  assert.equal(parsed.auth.apiKey.secretRef, "vault://tenant-1/openai/api-key");

  assert.throws(() => {
    providerAuthConfigSchema.parse({ scheme: "API_KEY" });
  });

  assert.throws(() => {
    providerDescriptorSchema.parse({ ...descriptor, auth: { scheme: "BEARER_TOKEN", token: { value: "not-allowed" } } });
  });
});

test("AI provider compatible contracts are validated without SDK or network assumptions", () => {
  const openAiRequest = openAiCompatibleRequestSchema.parse({
    tenantId: "tenant-1",
    providerId: "provider-openai-1",
    compatibility: "OPENAI_COMPATIBLE",
    model: "future-openai-model",
    messages: [{ role: "USER", content: "Draft a safe reply." }],
    responseFormat: "JSON_OBJECT"
  });

  assert.equal(openAiRequest.endpointPath, "/v1/chat/completions");

  const anthropicRequest = anthropicCompatibleRequestSchema.parse({
    tenantId: "tenant-1",
    providerId: "provider-anthropic-1",
    compatibility: "ANTHROPIC_COMPATIBLE",
    anthropicVersion: "2023-06-01",
    model: "future-anthropic-model",
    messages: [{ role: "USER", content: "Summarize this lead." }]
  });

  assert.equal(anthropicRequest.compatibility, "ANTHROPIC_COMPATIBLE");

  assert.throws(() => {
    openAiCompatibleRequestSchema.parse({ ...openAiRequest, messages: [] });
  });
});

test("social, email, and webhook placeholder contracts enforce provider domains", () => {
  const meta = metaProviderContractSchema.parse({
    ...descriptor,
    providerId: "provider-meta-1",
    kind: "META",
    domain: "SOCIAL",
    displayName: "Meta tenant adapter",
    capabilities: ["SOCIAL_PUBLISH", "WEBHOOK_INGEST"],
    auth: { scheme: "OAUTH2", clientId: "meta-client", clientSecret: { secretRef: "vault://tenant-1/meta/client-secret" }, scopes: ["pages_manage_posts"] }
  });
  assert.equal(meta.kind, "META");

  const linkedIn = linkedInProviderContractSchema.parse({
    ...descriptor,
    providerId: "provider-linkedin-1",
    kind: "LINKEDIN",
    domain: "SOCIAL",
    displayName: "LinkedIn tenant adapter",
    capabilities: ["SOCIAL_PUBLISH", "SOCIAL_READ"],
    auth: { scheme: "OAUTH2", clientId: "linkedin-client", clientSecret: { secretRef: "vault://tenant-1/linkedin/client-secret" }, scopes: ["w_member_social"] }
  });
  assert.equal(linkedIn.kind, "LINKEDIN");

  const email = emailProviderContractSchema.parse({
    ...descriptor,
    providerId: "provider-sendgrid-1",
    kind: "SENDGRID",
    domain: "EMAIL",
    displayName: "SendGrid tenant adapter",
    capabilities: ["EMAIL_SEND", "WEBHOOK_INGEST"]
  });
  assert.equal(email.domain, "EMAIL");

  const webhook = webhookProviderContractSchema.parse({
    ...descriptor,
    providerId: "provider-webhook-1",
    kind: "WEBHOOK",
    domain: "WEBHOOK",
    displayName: "Tenant webhook adapter",
    capabilities: ["WEBHOOK_INGEST"]
  });
  assert.equal(webhook.capabilities[0], "WEBHOOK_INGEST");

  assert.throws(() => {
    metaProviderContractSchema.parse({ ...meta, domain: "EMAIL" });
  });
});

test("provider tenant guard fails closed before execution on missing or mismatched tenant scope", () => {
  assert.doesNotThrow(() => {
    assertProviderTenantIsolation(context, descriptor);
  });

  assert.throws(
    () => assertProviderTenantIsolation(context, {}),
    (error) => error instanceof ProviderRuntimeError && error.code === "PROVIDER_TENANT_CONTEXT_MISSING"
  );

  assert.throws(
    () => assertProviderTenantIsolation(context, { tenantId: "tenant-2", providerId: "provider-openai-1" }),
    (error) => error instanceof ProviderRuntimeError && error.code === "PROVIDER_TENANT_MISMATCH"
  );

  assert.throws(
    () => assertProviderCapability(descriptor, "EMBEDDINGS", context),
    (error) => error instanceof ProviderRuntimeError && error.code === "PROVIDER_CAPABILITY_UNSUPPORTED"
  );
});

test("provider response normalization creates deterministic provider-neutral responses", () => {
  const response = normalizeProviderTextResponse({
    tenantId: "tenant-1",
    providerId: "provider-openai-1",
    providerKind: "OPENAI",
    model: "future-openai-model",
    content: "Hello",
    finishReason: "max_tokens",
    inputTokens: 10,
    outputTokens: 5,
    rawResponseId: "resp-1",
    correlationId: "corr-provider-1"
  });

  assert.equal(response.finishReason, "LENGTH");
  assert.equal(response.usage.totalTokens, 15);

  const embeddings = normalizeEmbeddingResponse({
    tenantId: "tenant-1",
    providerId: "provider-embedding-1",
    model: "future-embedding-model",
    embeddings: [[0.1, 0.2, 0.3]],
    correlationId: "corr-provider-1"
  });

  assert.deepEqual(embeddings.embeddings[0], [0.1, 0.2, 0.3]);
  assert.equal(embeddings.usage.inputTokens, 0);

  assert.throws(
    () => normalizeEmbeddingResponse({
      tenantId: "tenant-1",
      providerId: "provider-embedding-1",
      providerKind: "OPENAI",
      model: "future-embedding-model",
      embeddings: [[]],
      correlationId: "corr-provider-1"
    }),
    (error) => error instanceof ProviderRuntimeError && error.code === "PROVIDER_NORMALIZATION_FAILED"
  );
});

test("provider validation helper raises typed errors with sanitized issue details", () => {
  assert.throws(
    () => parseProviderContract(openAiCompatibleRequestSchema, { tenantId: "tenant-1" }, context),
    (error) => {
      assert.equal(error instanceof ProviderRuntimeError, true);
      assert.equal(error.code, "PROVIDER_CONFIG_INVALID");
      assert.equal(error.providerId, "provider-openai-1");
      assert.equal(Array.isArray(error.details.issues), true);
      return true;
    }
  );
});
