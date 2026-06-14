import assert from 'node:assert/strict';
import test from 'node:test';

import { computeAcquisitionSummary, formatAcquisitionConversionRate } from '../src/lib/acquisition-summary.js';

const pipeline = Object.freeze({
  stages: Object.freeze([
    Object.freeze({ id: 'stage-captured', name: 'Captured' }),
    Object.freeze({ id: 'stage-invited', name: 'Invited' }),
    Object.freeze({ id: 'stage-claim-started', name: 'Claim Started' }),
    Object.freeze({ id: 'stage-claimed', name: 'Claimed' }),
    Object.freeze({ id: 'stage-converted', name: 'Converted' }),
    Object.freeze({ id: 'stage-expired', name: 'Expired' }),
  ]),
});

test('computes marketplace acquisition counts from existing stage data', () => {
  const summary = computeAcquisitionSummary(pipeline, [
    { id: 'deal-1', pipelineStageId: 'stage-captured' },
    { id: 'deal-2', pipelineStageId: 'stage-captured' },
    { id: 'deal-3', pipelineStageId: 'stage-invited' },
    { id: 'deal-4', pipelineStageId: 'stage-claim-started' },
    { id: 'deal-5', pipelineStageId: 'stage-claimed' },
    { id: 'deal-6', pipelineStageId: 'stage-converted' },
    { id: 'deal-7', pipelineStageId: 'stage-expired' },
  ]);

  assert.deepEqual(summary, {
    captured: 2,
    invited: 1,
    claimStarted: 1,
    claimed: 1,
    converted: 1,
    expired: 1,
    conversionRate: 0.5,
    recentCount: 7,
  });
});

test('uses a safe zero conversion rate when no captured deals exist', () => {
  const summary = computeAcquisitionSummary(pipeline, [
    { id: 'deal-1', pipelineStageId: 'stage-converted' },
  ]);

  assert.equal(summary.captured, 0);
  assert.equal(summary.conversionRate, 0);
  assert.equal(formatAcquisitionConversionRate(summary.conversionRate), '0%');
});
