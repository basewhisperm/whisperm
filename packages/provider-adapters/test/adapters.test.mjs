import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnthropicProviderAdapter,
  GeminiProviderAdapter,
  OpenAIProviderAdapter,
  OpenAiProviderAdapter,
  ProviderModelExecutionRuntime,
  HttpSmsProvider,
  createHttpSmsProviderFromEnv,
} from '../dist/index.js';
import { ProviderRuntimeError } from '../../types/dist/index.js';

const correlation = { correlationId: 'corr-1', traceId: 'trace-1' };
const request = {
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  messages: [{ role: 'USER', content: 'Write a safe reply.' }],
  requiredCapabilities: ['TEXT_GENERATION'],
  options: { responseFormat: 'TEXT', maxOutputTokens: 128 },
  toolNames: [],
  memoryRefs: [],
  correlation,
};

const route = {
  tenantId: 'tenant-1',
  providerId: 'provider-openai-1',
  providerKind: 'OPENAI',
  model: 'mock-openai-model',
  reason: 'test-route',
  capabilities: ['TEXT_GENERATION'],
  maxInputTokens: 4096,
  maxOutputTokens: 1024,
};

const descriptor = {
  tenantId: 'tenant-1',
  providerId: 'provider-openai-1',
  kind: 'OPENAI',
  domain: 'AI',
  displayName: 'Tenant OpenAI adapter',
  enabled: true,
  capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT', 'EMBEDDINGS'],
  auth: { scheme: 'API_KEY', apiKey: { secretRef: 'vault://tenant-1/openai/api-key' } },
};

const createDependencies = (overrides = {}) => ({
  secretResolver: {
    async resolveSecretReference(resolveRequest) {
      assert.equal(resolveRequest.tenantId, 'tenant-1');
      assert.equal(resolveRequest.secretRef, 'vault://tenant-1/openai/api-key');
      return { value: 'mock-secret-value' };
    },
  },
  transport: {
    async sendText(transportRequest) {
      assert.equal(transportRequest.tenantId, 'tenant-1');
      assert.equal(transportRequest.apiKey, 'mock-secret-value');
      assert.equal(transportRequest.correlationId, 'corr-1');
      assert.equal(transportRequest.messages[0].role, 'user');
      return {
        id: 'raw-response-1',
        content: 'Hello from a mock provider.',
        finishReason: 'stop',
        inputTokens: 12,
        outputTokens: 6,
      };
    },
  },
  ...overrides,
});

const assertProviderRuntimeError = (code) => (error) => {
  assert.equal(error instanceof ProviderRuntimeError, true);
  assert.equal(error.code, code);
  return true;
};

test('OpenAI adapter resolves secret references and maps normalized responses without live calls', async () => {
  const events = [];
  const adapter = new OpenAiProviderAdapter(descriptor, createDependencies({
    telemetry: {
      onProviderStart(event) { events.push(['start', event]); },
      onProviderComplete(event) { events.push(['complete', event]); },
      onProviderError(event) { events.push(['error', event]); },
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  }));

  const response = await adapter.generate(request, route);

  assert.equal(response.providerId, 'provider-openai-1');
  assert.equal(response.providerKind, 'OPENAI');
  assert.equal(response.message.content, 'Hello from a mock provider.');
  assert.equal(response.usage.totalTokens, 18);
  assert.equal(response.finishReason, 'STOP');
  assert.deepEqual(events.map(([name]) => name), ['start', 'complete']);
  assert.equal(events[1][1].usage.totalTokens, 18);
});

test('OpenAIProviderAdapter alias supports structured output capability validation', async () => {
  const adapter = new OpenAIProviderAdapter(descriptor, createDependencies({
    transport: {
      async sendText(transportRequest) {
        assert.equal(transportRequest.responseFormat, 'JSON_OBJECT');
        assert.equal(transportRequest.correlationId, 'corr-1');
        return {
          id: 'structured-response-1',
          content: '{"ok":true}',
          finishReason: 'stop',
          inputTokens: 10,
          outputTokens: 4,
        };
      },
    },
  }));

  const response = await adapter.generate({
    ...request,
    options: { responseFormat: 'JSON_OBJECT', maxOutputTokens: 64 },
  }, { ...route, capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] });

  assert.equal(response.message.content, '{"ok":true}');
  assert.equal(response.usage.totalTokens, 14);

  await assert.rejects(
    () => adapter.generate({
      ...request,
      options: { responseFormat: 'JSON_OBJECT', maxOutputTokens: 64 },
    }, route),
    assertProviderRuntimeError('PROVIDER_CAPABILITY_UNSUPPORTED'),
  );
});

test('adapters support deterministic embeddings through mock transports', async () => {
  const adapter = new GeminiProviderAdapter({ ...descriptor, providerId: 'provider-gemini-1', kind: 'GEMINI', displayName: 'Tenant Gemini adapter' }, createDependencies({
    transport: {
      async sendText() {
        throw new Error('text transport should not be called');
      },
      async sendEmbedding(embeddingRequest) {
        assert.equal(embeddingRequest.tenantId, 'tenant-1');
        assert.equal(embeddingRequest.providerId, 'provider-gemini-1');
        assert.equal(embeddingRequest.providerKind, 'GEMINI');
        assert.equal(embeddingRequest.apiKey, 'mock-secret-value');
        assert.equal(embeddingRequest.correlationId, 'corr-1');
        assert.deepEqual(embeddingRequest.inputs, ['alpha', 'beta']);
        return { embeddings: [[0.1, 0.2], [0.3, 0.4]], inputTokens: 2 };
      },
    },
  }));

  const response = await adapter.embed({
    tenantId: 'tenant-1',
    providerId: 'provider-gemini-1',
    model: 'gemini-embedding-mock',
    input: ['alpha', 'beta'],
  }, {
    tenantId: 'tenant-1',
    providerId: 'provider-gemini-1',
    providerKind: 'GEMINI',
    operation: 'test.embed',
    correlationId: 'corr-1',
    actorId: 'agent-1',
  });

  assert.deepEqual(response.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
  assert.equal(response.usage.inputTokens, 2);
  assert.equal(response.correlationId, 'corr-1');
});

test('provider health checks propagate tenant-safe correlation and never expose secrets', async () => {
  const adapter = new AnthropicProviderAdapter({
    ...descriptor,
    providerId: 'provider-anthropic-1',
    kind: 'ANTHROPIC',
    displayName: 'Tenant Anthropic adapter',
    metadata: { healthCheckModel: 'claude-health-mock' },
  }, createDependencies({
    transport: {
      async sendText() {
        throw new Error('text transport should not be called');
      },
      async checkHealth(healthRequest) {
        assert.equal(healthRequest.tenantId, 'tenant-1');
        assert.equal(healthRequest.providerId, 'provider-anthropic-1');
        assert.equal(healthRequest.providerKind, 'ANTHROPIC');
        assert.equal(healthRequest.model, 'claude-health-mock');
        assert.equal(healthRequest.apiKey, 'mock-secret-value');
        assert.equal(healthRequest.correlationId, 'corr-1');
        return { status: 'HEALTHY', latencyMs: 12, message: 'mock transport healthy' };
      },
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  }));

  const health = await adapter.health({
    tenantId: 'tenant-1',
    providerId: 'provider-anthropic-1',
    providerKind: 'ANTHROPIC',
    operation: 'test.health',
    correlationId: 'corr-1',
    actorId: 'agent-1',
  });

  assert.equal(health.status, 'HEALTHY');
  assert.equal(health.latencyMs, 12);
  assert.equal(health.correlationId, 'corr-1');
});




test('AnthropicProviderAdapter forwards configured anthropicVersion to transport', async () => {
  const adapter = new AnthropicProviderAdapter({
    ...descriptor,
    providerId: 'provider-anthropic-1',
    kind: 'ANTHROPIC',
    displayName: 'Tenant Anthropic adapter',
    metadata: { anthropicVersion: '2023-06-01' },
  }, createDependencies({
    secretResolver: {
      async resolveSecretReference(resolveRequest) {
        assert.equal(resolveRequest.tenantId, 'tenant-1');
        return { value: 'mock-secret-value' };
      },
    },
    transport: {
      async sendText(transportRequest) {
        assert.equal(transportRequest.providerKind, 'ANTHROPIC');
        assert.equal(transportRequest.providerId, 'provider-anthropic-1');
        assert.equal(transportRequest.anthropicVersion, '2023-06-01');
        return {
          id: 'anthropic-response-1',
          content: 'Hello from a mock Anthropic provider.',
          finishReason: 'stop',
          inputTokens: 8,
          outputTokens: 5,
        };
      },
    },
  }));

  const response = await adapter.generate(request, {
    ...route,
    providerId: 'provider-anthropic-1',
    providerKind: 'ANTHROPIC',
    model: 'mock-anthropic-model',
  });

  assert.equal(response.providerKind, 'ANTHROPIC');
});

test('Anthropic and Gemini adapter skeletons enforce descriptor kind compatibility', async () => {
  const anthropic = new AnthropicProviderAdapter({ ...descriptor, providerId: 'provider-anthropic-1', kind: 'ANTHROPIC', displayName: 'Tenant Anthropic adapter' }, createDependencies());
  const anthropicRoute = { ...route, providerId: 'provider-anthropic-1', providerKind: 'ANTHROPIC', model: 'mock-anthropic-model' };
  const anthropicResponse = await anthropic.generate(request, anthropicRoute);
  assert.equal(anthropicResponse.providerKind, 'ANTHROPIC');

  const gemini = new GeminiProviderAdapter({ ...descriptor, providerId: 'provider-gemini-1', kind: 'GEMINI', displayName: 'Tenant Gemini adapter' }, createDependencies());
  const geminiRoute = { ...route, providerId: 'provider-gemini-1', providerKind: 'GEMINI', model: 'mock-gemini-model' };
  const geminiResponse = await gemini.generate(request, geminiRoute);
  assert.equal(geminiResponse.providerKind, 'GEMINI');
});

test('adapter fails closed when tenant context is missing before resolving secrets', async () => {
  let secretResolved = false;
  const adapter = new OpenAiProviderAdapter(descriptor, createDependencies({
    secretResolver: {
      async resolveSecretReference() {
        secretResolved = true;
        return { value: 'mock-secret-value' };
      },
    },
  }));

  await assert.rejects(
    () => adapter.generate({ ...request, tenantId: '' }, route),
    assertProviderRuntimeError('PROVIDER_AUTH_INVALID'),
  );
  assert.equal(secretResolved, false);
});

test('adapter fails closed when secretRef is missing', async () => {
  let secretResolved = false;
  const missingSecretDescriptor = {
    ...descriptor,
    auth: { scheme: 'NONE', scopes: [] },
  };
  const adapter = new OpenAiProviderAdapter(missingSecretDescriptor, createDependencies({
    secretResolver: {
      async resolveSecretReference() {
        secretResolved = true;
        return { value: 'mock-secret-value' };
      },
    },
  }));

  await assert.rejects(
    () => adapter.generate(request, route),
    assertProviderRuntimeError('PROVIDER_AUTH_INVALID'),
  );
  assert.equal(secretResolved, false);
});

test('model runtime integrates routing, configuration loading, adapter execution, and token accounting', async () => {
  const records = [];
  const adapter = new OpenAiProviderAdapter(descriptor, createDependencies());
  const runtime = new ProviderModelExecutionRuntime({
    router: { async route(routeRequest) { assert.equal(routeRequest.estimatedInputTokens, 7); return route; } },
    accountant: {
      async estimate() { return { inputTokens: 7, outputTokens: 0, totalTokens: 7 }; },
      async record(record) { records.push(record); },
    },
    configLoader: {
      async loadProviderConfiguration(loadRequest) {
        assert.equal(loadRequest.tenantId, 'tenant-1');
        return descriptor;
      },
    },
    registry: { getAdapter(providerId) { return providerId === 'provider-openai-1' ? adapter : undefined; } },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const response = await runtime.generate(request);

  assert.equal(response.providerId, 'provider-openai-1');
  assert.equal(records.length, 1);
  assert.equal(records[0].usage.totalTokens, 18);
  assert.equal(records[0].tenantId, 'tenant-1');
});

test('retry and circuit-breaker contracts are invoked with mocked provider failures only', async () => {
  let attempts = 0;
  const failures = [];
  const successes = [];
  const adapter = new OpenAiProviderAdapter(descriptor, createDependencies({
    transport: {
      async sendText() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('mock transient failure');
        }
        return { content: 'Recovered', finishReason: 'stop', inputTokens: 1, outputTokens: 1 };
      },
    },
    reliability: {
      retryPolicy: {
        maxAttempts: 2,
        shouldRetry(error, attempt) { return error.code === 'PROVIDER_UNAVAILABLE' && attempt === 1; },
        nextDelayMs() { return 0; },
      },
      circuitBreaker: {
        async canExecute() { return true; },
        async recordSuccess(context) { successes.push(context.providerId); },
        async recordFailure(context) { failures.push(context.providerId); },
      },
    },
    sleep: async () => {},
  }));

  const response = await adapter.generate(request, route);

  assert.equal(response.message.content, 'Recovered');
  assert.equal(attempts, 2);
  assert.deepEqual(successes, ['provider-openai-1']);
  assert.deepEqual(failures, []);
});

test('normalized provider error mapping emits typed timeout errors', async () => {
  const adapter = new OpenAiProviderAdapter(descriptor, createDependencies({
    transport: {
      async sendText() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { content: 'too late', finishReason: 'stop', inputTokens: 1, outputTokens: 1 };
      },
    },
    reliability: { timeoutPolicy: { timeoutMs: 1 } },
  }));

  await assert.rejects(
    () => adapter.generate(request, route),
    assertProviderRuntimeError('PROVIDER_TIMEOUT'),
  );
});

test('HTTP SMS provider posts seller invitation payload with environment configuration', async () => {
  const calls = [];
  const provider = new HttpSmsProvider({
    providerName: 'generic-http',
    apiUrl: 'https://sms.test/send',
    apiKey: 'secret-key',
    senderId: 'WhispeRM',
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return new Response('{}', { status: 202 });
    },
  });

  await provider.send({ to: '+15555550123', body: 'Invite link' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sms.test/send');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    provider: 'generic-http',
    from: 'WhispeRM',
    to: '+15555550123',
    body: 'Invite link',
  });
});

test('HTTP SMS provider requires complete seller invitation SMS environment', () => {
  assert.throws(
    () => createHttpSmsProviderFromEnv({ SELLER_INVITATION_SMS_PROVIDER: 'generic-http', SELLER_INVITATION_SMS_API_URL: 'https://sms.test/send', SELLER_INVITATION_SMS_API_KEY: 'secret-key' }),
    /SELLER_INVITATION_SMS_SENDER_ID/u,
  );
});
