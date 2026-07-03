import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryQueueRuntime,
  createWorkerApplication,
} from '../dist/index.js';

const fixedDate = new Date('2026-01-01T00:00:00.000Z');
const correlation = { correlationId: 'corr-1', requestId: 'req-1' };
const clock = { now: () => fixedDate };

const createRuntimePorts = () => {
  const completed = [];
  return {
    completed,
    ports: {
      idempotency: {
        claim: () => ({ status: 'CLAIMED' }),
        complete: (input) => { completed.push(input); },
      },
      clock,
    },
  };
};

const createJob = (overrides = {}) => ({
  tenantId: 'tenant-1',
  jobId: 'job-1',
  queueName: 'event.ingestion',
  jobType: 'event.ingestion',
  version: 1,
  payload: {
    event: {
      tenantId: 'tenant-1',
      source: {
        provider: 'WEB_FORM',
        providerEventId: 'provider-event-1',
        eventType: 'lead.created',
      },
      payload: { leadId: 'lead-1' },
    },
  },
  correlation,
  idempotency: {
    tenantId: 'tenant-1',
    scope: 'EXTERNAL_EVENT',
    key: 'tenant-1:WEB_FORM:provider-event-1',
    replaySafe: true,
    conflictPolicy: 'SKIP_DUPLICATE',
  },
  scheduling: {
    tenantId: 'tenant-1',
    queueName: 'event.ingestion',
    priority: 'NORMAL',
  },
  retryPolicy: {
    tenantId: 'tenant-1',
    maxAttempts: 1,
    backoff: {
      kind: 'NONE',
      baseDelayMs: 0,
      maxDelayMs: 0,
      multiplier: 2,
      jitter: false,
    },
    retryableErrorCodes: [],
    nonRetryableErrorCodes: ['WORKER_RUNTIME_VALIDATION_FAILED'],
    deadLetterAfterMaxAttempts: true,
    replaySafe: true,
  },
  poisonPolicy: {
    tenantId: 'tenant-1',
    enabled: false,
    maxValidationFailures: 1,
    maxConsecutiveFailures: 3,
    deadLetterOnPoison: true,
  },
  createdAt: fixedDate.toISOString(),
  metadata: {},
  ...overrides,
});

const createApp = (services, runtimePorts, queues = new InMemoryQueueRuntime()) => createWorkerApplication({
  config: {
    tenantId: 'tenant-1',
    workerId: 'worker-1',
    gracefulShutdownMs: 1000,
    heartbeatIntervalMs: 5000,
    runtimeVersion: 'test',
    correlation,
  },
  services,
  queues,
  runtimePorts,
  clock,
  telemetry: {},
  logger: { info() {}, warn() {}, error() {} },
});

test('registers event ingestion, score recomputation, notification, claim lifecycle, render retry, publish, and scheduler workers on startup', async () => {
  const queues = new InMemoryQueueRuntime();
  const runtime = createRuntimePorts();
  const app = createApp({ events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) } }, runtime.ports, queues);

  const registrations = await app.start();

  assert.deepEqual(registrations.map((registration) => registration.queue.queueName), ['event.ingestion', 'crm.scoring', 'notification', 'marketplace.claim.lifecycle', 'marketplace.crm.conversion', 'render.conversion.retry', 'marketplace.invite', 'marketplace.discovery', 'marketplace.qualification', 'publish', 'scheduler']);
  assert.deepEqual(registrations.map((registration) => registration.worker.jobTypes[0]), ['event.ingestion', 'crm.score.recompute', 'notification.trial_reminder', 'marketplace.claim.reminder', 'marketplace.crm.conversion.execute', 'render.conversion.retry', 'marketplace.invite.send', 'marketplace.discovery.execute', 'marketplace.qualification.execute', 'publish.dispatch', 'scheduler.tick']);
  assert.equal(app.getReadiness().status, 'HEALTHY');
  assert.equal(queues.isWorkerActive('event-ingestion-worker'), true);
  assert.equal(queues.isWorkerActive('score-recomputation-worker'), true);
  assert.equal(queues.isWorkerActive('notification-worker'), true);
  assert.equal(queues.isWorkerActive('claim-lifecycle-worker'), true);
  assert.equal(queues.isWorkerActive('crm-conversion-worker'), true);
  assert.equal(queues.isWorkerActive('render-conversion-retry-worker'), true);
  assert.equal(queues.isWorkerActive('marketplace-discovery-worker'), true);
  assert.equal(queues.isWorkerActive('marketplace-qualification-worker'), true);
  assert.equal(queues.isWorkerActive('publish-worker'), true);
  assert.equal(queues.isWorkerActive('scheduler-worker'), true);
});

test('event ingestion worker propagates tenant and correlation through DI service', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: {
      ingest: async (context, input) => {
        calls.push({ context, input });
        return { id: 'ingestion-1', tenantId: input.tenantId };
      },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({ job: createJob() });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.result.ingestionId, 'ingestion-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.tenantId, 'tenant-1');
  assert.equal(calls[0].context.correlation.correlationId, 'corr-1');
  assert.equal(calls[0].input.provider, 'WEB_FORM');
  assert.equal(calls[0].input.correlationId, 'corr-1');
  assert.equal(runtime.completed.length, 1);
});

test('invalid event payload is deterministically dead-lettered', async () => {
  const queues = new InMemoryQueueRuntime();
  const runtime = createRuntimePorts();
  const app = createApp({ events: { ingest: async () => ({ id: 'never-called', tenantId: 'tenant-1' }) } }, runtime.ports, queues);
  await app.start();

  const result = await app.processJob({ job: createJob({ payload: { event: { tenantId: 'tenant-1' } } }) });

  assert.equal(result.status, 'DEAD_LETTERED');
  assert.equal(result.deadLetter.reason, 'NON_RETRYABLE_ERROR');
  assert.equal(queues.getDeadLetters().length, 1);
  assert.equal(queues.getDeadLetters()[0].job.tenantId, 'tenant-1');
  assert.equal(queues.getDeadLetters()[0].error.code, 'WORKER_RUNTIME_VALIDATION_FAILED');
});

test('shutdown drains registered workers and reports stopped health', async () => {
  const queues = new InMemoryQueueRuntime();
  const runtime = createRuntimePorts();
  const app = createApp({ events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) } }, runtime.ports, queues);
  await app.start();

  const shutdown = await app.stop('test complete');

  assert.equal(shutdown.mode, 'DRAIN');
  assert.equal(queues.isWorkerActive('event-ingestion-worker'), false);
  assert.equal(queues.isWorkerActive('score-recomputation-worker'), false);
  assert.equal(queues.isWorkerActive('claim-lifecycle-worker'), false);
  assert.equal(queues.isWorkerActive('publish-worker'), false);
  assert.equal(queues.isWorkerActive('scheduler-worker'), false);
  assert.equal(app.getHealth().status, 'STOPPED');
});


test('score recomputation worker skips duplicate jobs idempotently', async () => {
  const calls = [];
  const runtime = {
    completed: [],
    ports: {
      idempotency: {
        claim: () => ({ status: 'DUPLICATE', previousResult: { tenantId: 'tenant-1', contactId: 'contact-1', leadScore: 90, trajectoryScore: 0, trustBand: 'HIGH', correlationId: 'corr-1' } }),
        complete: (input) => { runtime.completed.push(input); },
      },
      clock,
    },
  };
  const app = createApp({
    events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) },
    scoring: {
      recomputeContactScore: async (scoreContext, input) => {
        calls.push({ scoreContext, input });
        return {
          tenantId: input.tenantId,
          contactId: input.contactId,
          leadScore: 90,
          trajectoryScore: 0,
          trustBand: 'HIGH',
          leadScoreBreakdown: { eventScore: 90, identityScore: 20, engagementScore: 70, eventCount: 3 },
          trajectoryScoreBreakdown: { score: 0, recentScore: 35, previousScore: 35, recentEventCount: 2, previousEventCount: 1 },
          recomputedAt: fixedDate.toISOString(),
          correlation,
        };
      },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({ job: createJob({
    jobId: 'score-job-1',
    queueName: 'crm.scoring',
    jobType: 'crm.score.recompute',
    payload: { tenantId: 'tenant-1', contactId: 'contact-1', reason: 'test', requestedAt: fixedDate.toISOString(), correlation },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'crm.score.recompute:tenant-1:contact-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'crm.scoring', priority: 'NORMAL' },
  }) });

  assert.equal(result.status, 'DUPLICATE_SKIPPED');
  assert.equal(calls.length, 0);
  assert.equal(runtime.completed.length, 0);
  assert.equal(result.result.trustBand, 'HIGH');
});

test('retryable failures schedule a retry instead of dead-lettering', async () => {
  const runtime = createRuntimePorts();

  const app = createApp({
    events: {
      ingest: async () => {
        throw new Error('transient failure');
      },
    },
  }, runtime.ports);

  await app.start();

  const result = await app.processJob({
    job: createJob({
      retryPolicy: {
        tenantId: 'tenant-1',
        maxAttempts: 3,
        backoff: {
          kind: 'EXPONENTIAL',
          baseDelayMs: 1000,
          maxDelayMs: 10000,
          multiplier: 2,
          jitter: false,
        },
        retryableErrorCodes: ['WORKER_RUNTIME_VALIDATION_FAILED'],
        nonRetryableErrorCodes: [],
        deadLetterAfterMaxAttempts: true,
        replaySafe: true,
      },
    }),
  });

  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.equal(result.result.nextAttempt, 1);
});

test('poison messages are dead-lettered with tenant-safe metadata', async () => {
  const queues = new InMemoryQueueRuntime();
  const runtime = createRuntimePorts();

  const app = createApp({
    events: {
      ingest: async () => {
        throw new Error('invalid payload');
      },
    },
  }, runtime.ports, queues);

  await app.start();

  const result = await app.processJob({
    job: createJob({
      payload: {
        malformed: true,
      },
    }),
  });

  assert.equal(result.status, 'DEAD_LETTERED');
  assert.equal(queues.getDeadLetters().length, 1);

  const dlq = queues.getDeadLetters()[0];

  assert.equal(dlq.job.tenantId, 'tenant-1');
  assert.ok(dlq.reason);
});

test('concurrent jobs remain tenant isolated', async () => {
  const calls = [];

  const runtime = createRuntimePorts();

  const app = createApp({
    events: {
      ingest: async (context) => {
        calls.push(context.tenantId);
        return {
          id: `ingestion-${calls.length}`,
          tenantId: context.tenantId,
        };
      },
    },
  }, runtime.ports);

  await app.start();

  const jobs = Array.from({ length: 10 }, (_, index) =>
    app.processJob({
      job: createJob({
        jobId: `job-${index}`,
        idempotency: {
          tenantId: 'tenant-1',
          scope: 'EXTERNAL_EVENT',
          key: `tenant-1:event:${index}`,
          replaySafe: true,
          conflictPolicy: 'SKIP_DUPLICATE',
        },
      }),
    }),
  );

  const results = await Promise.all(jobs);

  assert.equal(results.length, 10);
  assert.equal(calls.length, 10);

  for (const tenantId of calls) {
    assert.equal(tenantId, 'tenant-1');
  }
});




test('crm conversion worker invokes runtime service with tenant isolation', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) },
    crmConversionRuntime: {
      executeConversion: async (context, input) => {
        calls.push({ context, input });
        return { status: 'CONVERTED', contactId: 'contact-1', dealId: 'deal-1', opportunityId: 'opp-1', idempotencyKey: 'crm-key-1' };
      },
    },
  }, runtime.ports);

  const result = await app.processJob({ job: createJob({
    jobId: 'crm-conversion-1',
    queueName: 'marketplace.crm.conversion',
    jobType: 'marketplace.crm.conversion.execute',
    payload: { tenantId: 'tenant-1', claimTokenId: 'token-1', marketplaceCaptureId: 'capture-1' },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'tenant-1:crm-conversion-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'marketplace.crm.conversion', priority: 'NORMAL' },
  }) });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(calls[0].context.tenantId, 'tenant-1');
  assert.equal(calls[0].input.claimTokenId, 'token-1');
  assert.equal(calls[0].input.marketplaceCaptureId, 'capture-1');
});

test('render conversion retry worker invokes retry service with tenant isolation', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) },
    renderConversionRetry: {
      retryRenderConversion: async (context, input) => {
        calls.push({ context, input });
        return { conversionId: input.conversionId, status: 'SUCCESS', attemptCount: 1, nextAttemptAt: null };
      },
    },
  }, runtime.ports);

  const result = await app.processJob({ job: createJob({
    jobId: 'render-retry-1',
    queueName: 'render.conversion.retry',
    jobType: 'render.conversion.retry',
    payload: { tenantId: 'tenant-1', conversionId: 'conversion-1' },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'tenant-1:render-retry-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'render.conversion.retry', priority: 'NORMAL' },
  }) });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(calls[0].context.tenantId, 'tenant-1');
  assert.equal(calls[0].input.conversionId, 'conversion-1');
});

test('marketplace invite worker completes runtime execution after successful invitation processing', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'unused', tenantId: 'tenant-1' }) },
    sellerInvitation: {
      async sendInvitation(context, input) {
        calls.push(['sendInvitation', context, input]);
        return { invitationId: 'invitation-1', status: 'SENT' };
      },
    },
    campaignRuntime: {
      async recordInvitationResult(context, input) {
        calls.push(['recordInvitationResult', context, input]);
      },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({
    job: createJob({
      queueName: 'marketplace.invite',
      jobType: 'marketplace.invite.send',
      payload: {
        tenantId: 'tenant-1',
        campaignId: 'campaign-1',
        captureId: 'capture-1',
        executionId: 'execution-1',
        channel: 'WHATSAPP',
      },
      idempotency: { ...createJob().idempotency, key: 'invite:tenant-1:capture-1' },
      scheduling: { ...createJob().scheduling, queueName: 'marketplace.invite' },
    }),
  });

  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(calls[0][2], { tenantId: 'tenant-1', captureId: 'capture-1', channel: 'WHATSAPP' });
  assert.deepEqual(calls[1][2], { executionId: 'execution-1', opportunityId: undefined, invitationId: 'invitation-1', status: 'SENT', channel: 'WHATSAPP', provider: 'WHATSAPP' });
});

test('marketplace invite worker records failed runtime execution when invitation processing fails', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'unused', tenantId: 'tenant-1' }) },
    sellerInvitation: {
      async sendInvitation() {
        throw new Error('provider failed token=secret');
      },
    },
    campaignRuntime: {
      async recordInvitationResult(context, input) {
        calls.push(['recordInvitationResult', context, input]);
      },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({
    job: createJob({
      queueName: 'marketplace.invite',
      jobType: 'marketplace.invite.send',
      payload: {
        tenantId: 'tenant-1',
        campaignId: 'campaign-1',
        captureId: 'capture-1',
        executionId: 'execution-1',
        channel: 'WHATSAPP',
      },
      idempotency: { ...createJob().idempotency, key: 'invite:tenant-1:capture-1:failed' },
      scheduling: { ...createJob().scheduling, queueName: 'marketplace.invite' },
    }),
  });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(calls[0][2].executionId, 'execution-1');
  assert.equal(calls[0][2].status, 'FAILED');
  assert.equal(calls[0][2].channel, 'WHATSAPP');
  assert.match(calls[0][2].errorMessage, /provider failed/);
  assert.equal(calls[0][2].retryable, false);
});

test('scheduler worker delegates due campaign execution to campaign runtime', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) },
    campaignRuntime: {
      runDueScheduledCampaigns: async (context, input) => {
        calls.push({ context, input });
        return { started: 2, skipped: 1 };
      },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({ job: createJob({
    queueName: 'scheduler',
    jobType: 'scheduler.tick',
    payload: { tenantId: 'tenant-1', now: fixedDate.toISOString(), limit: 25 },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'tenant-1:scheduler:tick', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'scheduler', priority: 'NORMAL' },
  }) });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.result.started, 2);
  assert.equal(result.result.skipped, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.tenantId, 'tenant-1');
  assert.equal(calls[0].input.now.toISOString(), fixedDate.toISOString());
  assert.equal(calls[0].input.limit, 25);
});

test('marketplace discovery worker executes through service port and records runtime success', async () => {
  const { ports } = createRuntimePorts();
  const calls = [];
  const app = createApp({
    events: { async ingest() { throw new Error('unused'); } },
    marketplaceDiscovery: {
      async executeAutonomousDiscovery(context, input) {
        calls.push({ context, input });
        return { discoveredCount: 2, capturedCount: 1, skippedDuplicateCount: 1 };
      },
    },
    campaignRuntime: {
      async recordInvitationResult() {},
      async recordDiscoveryResult(context, input) { calls.push({ recordContext: context, recordInput: input }); },
    },
  }, ports);
  const result = await app.processJob({ job: createJob({
    jobId: 'discovery-job-1',
    queueName: 'marketplace.discovery',
    jobType: 'marketplace.discovery.execute',
    payload: { tenantId: 'tenant-1', campaignId: 'campaign-1', executionId: 'execution-1', targeting: { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 10 }, replaySafe: true },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'discovery:execution-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'marketplace.discovery', priority: 'NORMAL' },
  }) });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(calls[0].input.executionId, 'execution-1');
  assert.equal(calls[0].input.targeting.keyword, 'bikes');
  assert.equal(calls[1].recordInput.status, 'COMPLETED');
  assert.equal(calls[1].recordInput.discoveredCount, 2);
});


test('marketplace qualification worker executes through service port and records runtime success', async () => {
  const { ports } = createRuntimePorts();
  const calls = [];
  const app = createApp({
    events: { async ingest() { throw new Error('unused'); } },
    marketplaceQualification: {
      async executeQualification(context, input) {
        calls.push({ context, input });
        return { qualifiedCount: 1, disqualifiedCount: 1, needsReviewCount: 0, skippedDuplicateCount: 1, failedCount: 0 };
      },
    },
    campaignRuntime: {
      async recordInvitationResult() {},
      async recordQualificationResult(context, input) { calls.push({ recordContext: context, recordInput: input }); },
    },
  }, ports);
  const result = await app.processJob({ job: createJob({
    jobId: 'qualification-job-1',
    queueName: 'marketplace.qualification',
    jobType: 'marketplace.qualification.execute',
    payload: { tenantId: 'tenant-1', campaignId: 'campaign-1', executionId: 'execution-1', replaySafe: true },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'qualification:execution-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'marketplace.qualification', priority: 'NORMAL' },
  }) });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(calls[0].input.campaignId, 'campaign-1');
  assert.equal(calls[1].recordInput.status, 'COMPLETED');
  assert.equal(calls[1].recordInput.qualifiedCount, 1);
});

test('marketplace discovery worker records failure before retry or dead-letter handling', async () => {
  const { ports } = createRuntimePorts();
  const recorded = [];
  const app = createApp({
    events: { async ingest() { throw new Error('unused'); } },
    marketplaceDiscovery: { async executeAutonomousDiscovery() { throw new Error('provider failed token=secret'); } },
    campaignRuntime: {
      async recordInvitationResult() {},
      async recordDiscoveryResult(_context, input) { recorded.push(input); },
    },
  }, ports);
  const result = await app.processJob({ job: createJob({
    jobId: 'discovery-job-2',
    queueName: 'marketplace.discovery',
    jobType: 'marketplace.discovery.execute',
    payload: { tenantId: 'tenant-1', campaignId: 'campaign-1', executionId: 'execution-1', targeting: { marketplaceSourceKey: 'JIJI', keyword: 'bikes', executionLimit: 10 }, replaySafe: true },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'discovery:execution-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'marketplace.discovery', priority: 'NORMAL' },
  }) });
  assert.equal(result.status, 'DEAD_LETTERED');
  assert.equal(recorded[0].status, 'FAILED');
});

test('claim intelligence worker validates tenant scope and calls canonical lifecycle port', async () => {
  const calls = [];
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) },
    claimLifecycle: {
      sendClaimReminder: async () => {},
      expireClaimInvitation: async () => {},
      evaluateClaimIntelligence: async (context, invitationId) => { calls.push(['evaluate', context.tenantId, invitationId]); },
      executeClaimRecovery: async (context, invitationId) => { calls.push(['recover', context.tenantId, invitationId]); },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({ job: createJob({
    jobId: 'claim-intelligence-1',
    queueName: 'marketplace.claim.lifecycle',
    jobType: 'marketplace.claim.intelligence',
    payload: { tenantId: 'tenant-1', invitationId: 'token-1', correlationId: 'corr-1', replaySafe: true },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'marketplace.claim.intelligence:tenant-1:token-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'marketplace.claim.lifecycle', priority: 'NORMAL' },
  }) });

  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(calls, [['evaluate', 'tenant-1', 'token-1'], ['recover', 'tenant-1', 'token-1']]);
});

test('claim lifecycle worker rejects cross-tenant claim jobs', async () => {
  const runtime = createRuntimePorts();
  const app = createApp({
    events: { ingest: async () => ({ id: 'ingestion-1', tenantId: 'tenant-1' }) },
    claimLifecycle: {
      sendClaimReminder: async () => { throw new Error('not expected'); },
      expireClaimInvitation: async () => { throw new Error('not expected'); },
      evaluateClaimIntelligence: async () => { throw new Error('not expected'); },
      executeClaimRecovery: async () => { throw new Error('not expected'); },
    },
  }, runtime.ports);
  await app.start();

  const result = await app.processJob({ job: createJob({
    jobId: 'claim-intelligence-tenant-mismatch',
    queueName: 'marketplace.claim.lifecycle',
    jobType: 'marketplace.claim.intelligence',
    payload: { tenantId: 'tenant-2', invitationId: 'token-1', replaySafe: true },
    idempotency: { tenantId: 'tenant-1', scope: 'JOB', key: 'marketplace.claim.intelligence:tenant-1:token-1', replaySafe: true, conflictPolicy: 'SKIP_DUPLICATE' },
    scheduling: { tenantId: 'tenant-1', queueName: 'marketplace.claim.lifecycle', priority: 'NORMAL' },
  }) });

  assert.equal(result.status, 'DEAD_LETTERED');
  assert.equal(result.deadLetter.error.code, 'WORKER_RUNTIME_TENANT_ISOLATION_VIOLATION');
});
