import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../dist/server.js';

const baseDeps = {
  apiKeyAuthenticator: { async authenticate(input) { return { tenantId: input.tenantId }; } },
  hmacVerifier: { async verify() { return true; } },
  ingest: { async ingest() { return {}; } },
};

test('render seller conversion API endpoint returns expected response', async () => {
  const calls = [];
  const server = createApiServer({
    ...baseDeps,
    renderSellerConversion: {
      async convertClaimedSellerToRender(context, input) {
        calls.push({ context, input });
        return { captureId: input.marketplaceCaptureId, contactId: 'contact-1', attestationId: 'att-1', renderSellerId: 'render-seller-1', conversionStatus: 'SUCCESS' };
      },
    },
  });

  const response = await server.inject({ method: 'POST', url: '/marketplace-acquisition/captures/capture-1/convert/render-seller', headers: { 'x-tenant-id': 'tenant-1', 'x-user-id': 'user-1', 'x-permissions': 'marketplace_acquisition.convert' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, { captureId: 'capture-1', contactId: 'contact-1', attestationId: 'att-1', renderSellerId: 'render-seller-1', conversionStatus: 'SUCCESS' });
  assert.equal(calls[0].context.tenantId, 'tenant-1');
});
