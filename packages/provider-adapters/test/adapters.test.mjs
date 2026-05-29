import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnthropicProviderAdapter,
  GeminiProviderAdapter,
  OpenAiProviderAdapter,
  ProviderModelExecutionRuntime,
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
  capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
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
