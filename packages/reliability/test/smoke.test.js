import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateBurnRate,
  calculateErrorBudgetRemaining,
  calculateRollingWindowBurnRate,
  createReliabilityIncident,
  evaluateHealthStatus,
} from '../dist/index.js';

const assertNearlyEqual = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-12);
};

test('evaluateHealthStatus returns HEALTHY', () => {
  assert.equal(evaluateHealthStatus(0.8), 'HEALTHY');
});

test('evaluateHealthStatus returns DEGRADED', () => {
  assert.equal(evaluateHealthStatus(1.4), 'DEGRADED');
});

test('evaluateHealthStatus returns UNHEALTHY', () => {
  assert.equal(evaluateHealthStatus(2.2), 'UNHEALTHY');
});

test('evaluateHealthStatus honors custom health thresholds', () => {
  const thresholds = { healthyMaxErrorRate: 0.5, degradedMaxErrorRate: 1.5 };

  assert.equal(evaluateHealthStatus(0.5, thresholds), 'HEALTHY');
  assert.equal(evaluateHealthStatus(1.5, thresholds), 'DEGRADED');
  assert.equal(evaluateHealthStatus(1.51, thresholds), 'UNHEALTHY');
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

test('calculateBurnRate returns observed error rate divided by SLO error budget', () => {
  assertNearlyEqual(calculateBurnRate({ observedErrorRate: 0.005, sloTarget: 0.999 }), 5);
  assert.equal(calculateBurnRate({ observedErrorRate: 0, sloTarget: 0.99 }), 0);
});

test('calculateErrorBudgetRemaining clamps remaining budget between zero and one', () => {
  assert.equal(calculateErrorBudgetRemaining({
    totalRequests: 1000,
    errorRequests: 0,
    sloTarget: 0.999,
  }), 1);

  assertNearlyEqual(calculateErrorBudgetRemaining({
    totalRequests: 1000,
    errorRequests: 1,
    sloTarget: 0.999,
  }), 0);

  assert.equal(calculateErrorBudgetRemaining({
    totalRequests: 1000,
    errorRequests: 2,
    sloTarget: 0.999,
  }), 0);
});

test('calculateRollingWindowBurnRate evaluates aggregate request/error counts deterministically', () => {
  assertNearlyEqual(calculateRollingWindowBurnRate({
    windows: [
      { totalRequests: 600, errorRequests: 1 },
      { totalRequests: 400, errorRequests: 2 },
    ],
    sloTarget: 0.99,
  }), 0.3);
});

test('calculateRollingWindowBurnRate requires at least one sample', () => {
  assert.throws(
    () => calculateRollingWindowBurnRate({ windows: [], sloTarget: 0.99 }),
    (error) => error instanceof RangeError && error.message === 'windows must include at least one sample',
  );
});

test('SLO target validation rejects invalid targets', () => {
  for (const sloTarget of [Number.NaN, 0, 1, -0.1, 1.1]) {
    assert.throws(
      () => calculateBurnRate({ observedErrorRate: 0.01, sloTarget }),
      (error) => error instanceof RangeError && error.message === 'sloTarget must be between 0 and 1 (exclusive)',
    );

    assert.throws(
      () => calculateErrorBudgetRemaining({ totalRequests: 10, errorRequests: 0, sloTarget }),
      (error) => error instanceof RangeError && error.message === 'sloTarget must be between 0 and 1 (exclusive)',
    );
  }
});

test('request and error count validation rejects invalid counts', () => {
  assert.throws(
    () => calculateErrorBudgetRemaining({ totalRequests: -1, errorRequests: 0, sloTarget: 0.99 }),
    (error) => error instanceof RangeError && error.message === 'totalRequests must be a finite non-negative number',
  );

  assert.throws(
    () => calculateErrorBudgetRemaining({ totalRequests: 10, errorRequests: Number.POSITIVE_INFINITY, sloTarget: 0.99 }),
    (error) => error instanceof RangeError && error.message === 'errorRequests must be a finite non-negative number',
  );

  assert.throws(
    () => calculateErrorBudgetRemaining({ totalRequests: 10, errorRequests: 11, sloTarget: 0.99 }),
    (error) => error instanceof RangeError && error.message === 'errorRequests cannot exceed totalRequests',
  );

  assert.throws(
    () => calculateRollingWindowBurnRate({
      windows: [
        { totalRequests: 10, errorRequests: 0 },
        { totalRequests: -1, errorRequests: 0 },
      ],
      sloTarget: 0.99,
    }),
    (error) => error instanceof RangeError && error.message === 'totalRequests must be a finite non-negative number',
  );

  assert.throws(
    () => calculateRollingWindowBurnRate({
      windows: [
        { totalRequests: 10, errorRequests: 0 },
        { totalRequests: 1, errorRequests: 2 },
      ],
      sloTarget: 0.99,
    }),
    (error) => error instanceof RangeError && error.message === 'errorRequests cannot exceed totalRequests',
  );
});
