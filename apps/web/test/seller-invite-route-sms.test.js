import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../src/app/api/marketplace-acquisition/captures/[id]/invite/route.ts', import.meta.url), 'utf8');

test('seller acquisition invite route delegates execution to campaign runtime', () => {
  assert.match(route, /CampaignRuntimeService/u);
  assert.match(route, /executeInvitation/u);
  assert.match(route, /invitationQueue/u);
  assert.match(route, /queueJob\.create/u);
});

test('seller acquisition invite route resolves campaign membership before runtime dispatch', () => {
  assert.match(route, /sellerAcquisitionCampaignMember\.findFirst/u);
  assert.match(route, /resolveCampaignId/u);
  assert.match(route, /Capture is not assigned to a campaign/u);
});

test('seller acquisition invite route no longer wires providers directly', () => {
  assert.doesNotMatch(route, /createHttpSmsProviderFromEnv/u);
  assert.doesNotMatch(route, /configuredSmsProvider/u);
  assert.doesNotMatch(route, /configuredEmailProvider/u);
  assert.doesNotMatch(route, /createMetaWhatsAppCloudProviderFromEnv/u);
});
