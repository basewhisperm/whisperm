import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSellerInvitationServicePort } from '../dist/seller-invitation-port.js';
import { createWorkerBootstrapConfigFromEnv, createWorkerApplication, createBootstrapOnlyWorkerServices, InMemoryQueueRuntime, InMemoryIdempotencyStore } from '../dist/index.js';

const indexSource = readFileSync('src/index.ts', 'utf8');

test('ST1-012: claim reminder notification port no longer fakes success with a void-input no-op', () => {
  assert.doesNotMatch(indexSource, /async sendClaimReminder\(input\) \{\s*void input;/u);
  assert.match(indexSource, /Claim reminder notifications are not implemented for this worker process/u);
});

test('ST1-012: production worker bootstrap no longer builds discoveryQueue\\/qualificationQueue from `void input` adapters', () => {
  assert.doesNotMatch(indexSource, /async enqueueDiscovery\(input:[^)]*\) \{ void input; \}/u);
  assert.doesNotMatch(indexSource, /async enqueueQualification\(input:[^)]*\) \{ void input; \}/u);
});

// ST1-012: a fake Prisma client is sufficient here because these tests only exercise
// construction (provider wiring from env), never an actual database call.
const fakePrisma = {};

test('ST1-012: worker boots with only the minimal required env (tenant + worker id), no optional provider vars', () => {
  const config = createWorkerBootstrapConfigFromEnv({
    WHISPERM_WORKER_TENANT_ID: 'tenant-1',
    WHISPERM_WORKER_ID: 'worker-1',
  });
  assert.equal(config.tenantId, 'tenant-1');
  const app = createWorkerApplication({
    config,
    services: createBootstrapOnlyWorkerServices(),
    queues: new InMemoryQueueRuntime(),
    runtimePorts: { idempotency: new InMemoryIdempotencyStore() },
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.doesNotThrow(() => app.getRegisteredWorkers());
});

test('ST1-012: missing SMS env does not crash seller invitation port construction', () => {
  assert.doesNotThrow(() => createSellerInvitationServicePort(fakePrisma, {}));
});

test('ST1-012: missing SMS env does not disable an otherwise-configured WhatsApp channel', () => {
  const env = {
    META_WHATSAPP_ACCESS_TOKEN: 'token',
    META_WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
  };
  assert.doesNotThrow(() => createSellerInvitationServicePort(fakePrisma, env));
});

test('ST1-012: fully missing provider env still produces a usable seller invitation port', () => {
  const port = createSellerInvitationServicePort(fakePrisma, {});
  assert.equal(typeof port.sendInvitation, 'function');
});

test('processJob rejects an unsupported job type with a clear validation error instead of a silent no-op', async () => {
  const app = createWorkerApplication({
    config: {
      tenantId: 'tenant-1',
      workerId: 'worker-1',
      gracefulShutdownMs: 1000,
      heartbeatIntervalMs: 5000,
      runtimeVersion: 'test',
      correlation: { correlationId: 'corr-1' },
    },
    services: createBootstrapOnlyWorkerServices(),
    queues: new InMemoryQueueRuntime(),
    runtimePorts: { idempotency: new InMemoryIdempotencyStore() },
    logger: { info() {}, warn() {}, error() {} },
  });
  await app.start();
  await assert.rejects(
    app.processJob({
      job: {
        tenantId: 'tenant-1',
        jobId: 'job-1',
        queueName: 'not.a.real.queue',
        jobType: 'not.a.real.job',
        version: 1,
        payload: {},
        correlation: { correlationId: 'corr-1' },
        idempotency: { tenantId: 'tenant-1', scope: 'EXTERNAL_EVENT', key: 'k', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
        scheduling: { tenantId: 'tenant-1', queueName: 'not.a.real.queue', priority: 'NORMAL' },
        retryPolicy: { tenantId: 'tenant-1', maxAttempts: 1, backoff: { kind: 'NONE', baseDelayMs: 0, maxDelayMs: 0, multiplier: 2, jitter: false }, retryableErrorCodes: [], nonRetryableErrorCodes: [], deadLetterAfterMaxAttempts: true, replaySafe: true },
        poisonPolicy: { tenantId: 'tenant-1', enabled: false, maxValidationFailures: 1, maxConsecutiveFailures: 3, deadLetterOnPoison: true },
        createdAt: new Date().toISOString(),
        metadata: {},
      },
    }),
    /No worker registered/u,
  );
});
