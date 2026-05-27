import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateBurnRate,
  calculateErrorBudgetRemaining,
  createReliabilityIncident,
  evaluateHealthStatus,
} from '../dist/index.js';

test('evaluateHealthStatus returns HEALTHY', () => {
  assert.equal(evaluateHealthStatus(0.8), 'HEALTHY');
});

test('evaluateHealthStatus returns DEGRADED', () => {
  assert.equal(evaluateHealthStatus(1.4), 'DEGRADED');
});

test('evaluateHealthStatus returns UNHEALTHY', () => {
  assert.equal(evaluateHealthStatus(2.2), 'UNHEALTHY');
});

test('createReliabilityIncident returns SEV0', () => {
  const incident = createReliabilityIncident({
    burnRate: 11,
    errorBudgetRemainingPercent: 0.04,
    status: 'UNHEALTHY',
    summary: 'critical reliability breach',
    tenantId: 'tenant-a',
    correlationId: 'corr-1',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(incident.severity, 'SEV0');
});

test('createReliabilityIncident returns SEV1', () => {
  const incident = createReliabilityIncident({
    burnRate: 6,
    errorBudgetRemainingPercent: 0.12,
    status: 'DEGRADED',
    summary: 'high burn rate',
    tenantId: 'tenant-a',
    correlationId: 'corr-2',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(incident.severity, 'SEV1');
});

test('createReliabilityIncident returns SEV2', () => {
  const incident = createReliabilityIncident({
    burnRate: 2.2,
    errorBudgetRemainingPercent: 0.3,
    status: 'DEGRADED',
    summary: 'moderate degradation',
    tenantId: 'tenant-a',
    correlationId: 'corr-3',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(incident.severity, 'SEV2');
});

test('createReliabilityIncident returns SEV3', () => {
  const incident = createReliabilityIncident({
    burnRate: 0.8,
    errorBudgetRemainingPercent: 0.6,
    status: 'HEALTHY',
    summary: 'minor alert',
    tenantId: 'tenant-a',
    correlationId: 'corr-4',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(incident.severity, 'SEV3');
});

test('burn rate and budget remaining use SLO math', () => {
  const burnRate = calculateBurnRate({ observedErrorRate: 0.005, sloTarget: 0.999 });
  assert.equal(burnRate, 5);

  const remaining = calculateErrorBudgetRemaining({
    totalRequests: 1000,
    errorRequests: 1,
    sloTarget: 0.999,
  });
  assert.equal(remaining, 0);
});
