import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProductionWorkerServices,
  PRODUCTION_CONFIGURED_WORKER_NAMES,
  createWorkerApplication,
  createBootstrapOnlyWorkerDependencies,
  createWorkerBootstrapConfigFromEnv,
  PrismaQueueRuntime,
} from '../dist/index.js';

// ST1-013N: a fake Prisma client is sufficient here because these tests only exercise
// construction (the exact same pattern worker-boot.test.js already uses) -- no method on any
// repository is actually invoked, only built.
const fakePrisma = {};

test('createProductionWorkerServices wires every real (non-stub) service port apps/web\'s queue-drain route needs', () => {
  const { services, queueJobs } = createProductionWorkerServices(fakePrisma, {});
  assert.ok(services.claimLifecycle, 'claimLifecycle service port missing');
  assert.ok(services.sellerInvitation, 'sellerInvitation service port missing');
  assert.ok(services.campaignRuntime, 'campaignRuntime service port missing');
  assert.ok(services.marketplaceDiscovery, 'marketplaceDiscovery service port missing');
  assert.ok(services.marketplaceQualification, 'marketplaceQualification service port missing');
  assert.ok(services.growthLoop, 'growthLoop service port missing');
  assert.ok(services.acquisitionGovernance, 'acquisitionGovernance service port missing');
  assert.ok(queueJobs, 'queueJobs repository missing');
});

test('PRODUCTION_CONFIGURED_WORKER_NAMES lists exactly the queues with a real service port wired', () => {
  assert.deepEqual(
    [...PRODUCTION_CONFIGURED_WORKER_NAMES].sort(),
    [
      'claim-lifecycle-worker',
      'growth-loop-worker',
      'marketplace-discovery-worker',
      'marketplace-invite-worker',
      'marketplace-qualification-worker',
      'scheduler-worker',
    ].sort(),
  );
});

test('a WorkerApplication built from createProductionWorkerServices registers a real queue name for every configured worker', () => {
  const config = createWorkerBootstrapConfigFromEnv({ WHISPERM_WORKER_TENANT_ID: 'shared-runtime', WHISPERM_WORKER_ID: 'test-worker' });
  const { services, queueJobs } = createProductionWorkerServices(fakePrisma, {});
  const app = createWorkerApplication({
    ...createBootstrapOnlyWorkerDependencies(config),
    queues: new PrismaQueueRuntime({ queueJobs }),
    services,
  });

  const configuredQueueNames = [...new Set(
    app.getRegisteredWorkers()
      .filter((definition) => PRODUCTION_CONFIGURED_WORKER_NAMES.has(definition.name))
      .map((definition) => definition.queue.queueName),
  )];

  // This is exactly the computation apps/web's queue-drain route (and this file's own
  // isMainModule bootstrap) needs to know which queues to actually poll.
  assert.equal(configuredQueueNames.length, PRODUCTION_CONFIGURED_WORKER_NAMES.size);
  assert.ok(configuredQueueNames.includes('marketplace.claim.lifecycle'));
  assert.ok(configuredQueueNames.includes('marketplace.invite'));
});
