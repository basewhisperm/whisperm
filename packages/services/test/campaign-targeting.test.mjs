import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCampaignTargetingSummary, getCampaignTargetingReadiness } from '@whisperm/services';

test('formats "Not configured" when metadata has no targeting', () => {
  assert.equal(formatCampaignTargetingSummary(undefined), 'Not configured');
  assert.equal(formatCampaignTargetingSummary(null), 'Not configured');
  assert.equal(formatCampaignTargetingSummary({}), 'Not configured');
});

test('formats "Not configured" when targeting has no marketplace or criteria', () => {
  assert.equal(formatCampaignTargetingSummary({ targeting: { executionLimit: 50, exclusionTerms: [] } }), 'Not configured');
});

test('formats marketplace-only targeting', () => {
  assert.equal(formatCampaignTargetingSummary({ targeting: { marketplaceSourceKey: 'JIJI' } }), 'JIJI · Limit: 50');
});

test('formats legacy marketplaceSourceId alongside criteria', () => {
  assert.equal(
    formatCampaignTargetingSummary({ targeting: { marketplaceSourceId: 'jiji-gh', keyword: 'Toyota' } }),
    'jiji-gh · Keywords: Toyota · Limit: 50',
  );
});

test('formats full targeting summary with keyword, category, location, and limit', () => {
  const summary = formatCampaignTargetingSummary({
    targeting: {
      marketplaceSourceKey: 'Jiji Ghana',
      keyword: 'Land Rover, Mercedes',
      location: 'Accra',
      executionLimit: 50,
    },
  });
  assert.equal(summary, 'Jiji Ghana · Keywords: Land Rover, Mercedes · Location: Accra · Limit: 50');
});

test('does not append execution limit when there is no other targeting criteria', () => {
  assert.equal(formatCampaignTargetingSummary({ targeting: { executionLimit: 100 } }), 'Not configured');
});

test('readiness is NOT_CONFIGURED with both missing reasons when targeting is absent', () => {
  const readiness = getCampaignTargetingReadiness(undefined);
  assert.equal(readiness.status, 'NOT_CONFIGURED');
  assert.deepEqual(readiness.missing, ['marketplace', 'targeting criteria']);
  assert.equal(readiness.summary, 'Missing marketplace and targeting criteria');
});

test('readiness reports missing targeting criteria when only marketplace exists', () => {
  const readiness = getCampaignTargetingReadiness({ targeting: { marketplaceSourceKey: 'JIJI' } });
  assert.equal(readiness.status, 'NOT_CONFIGURED');
  assert.deepEqual(readiness.missing, ['targeting criteria']);
  assert.equal(readiness.summary, 'Missing targeting criteria');
});

test('readiness reports missing marketplace when only keyword exists', () => {
  const readiness = getCampaignTargetingReadiness({ targeting: { keyword: 'Toyota' } });
  assert.equal(readiness.status, 'NOT_CONFIGURED');
  assert.deepEqual(readiness.missing, ['marketplace']);
  assert.equal(readiness.summary, 'Missing marketplace');
});

test('readiness is READY when marketplace plus one criterion exists', () => {
  const readiness = getCampaignTargetingReadiness({ targeting: { marketplaceSourceKey: 'JIJI', category: 'Vehicles' } });
  assert.equal(readiness.status, 'READY');
  assert.deepEqual(readiness.missing, []);
  assert.equal(readiness.summary, 'JIJI · Category: Vehicles · Limit: 50');
});

test('readiness treats an invalid stored targeting shape as not configured', () => {
  const readiness = getCampaignTargetingReadiness({ targeting: { priceMin: 500, priceMax: 100 } });
  assert.equal(readiness.status, 'NOT_CONFIGURED');
  assert.deepEqual(readiness.missing, ['marketplace', 'targeting criteria']);
});
