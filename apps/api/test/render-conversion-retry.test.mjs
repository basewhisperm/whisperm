import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderConversionRetryHandler } from '../dist/marketplace-acquisition/render-conversion-retry.js';

const reply = () => ({ status: 200, payload: undefined, code(status) { this.status = status; return this; }, send(payload) { this.payload = payload; return this; } });

test('manual render conversion retry endpoint enforces tenant isolation headers', async () => {
  const calls = [];
  const handler = createRenderConversionRetryHandler({ renderConversionRetry: { retryRenderConversion: async (context, input) => { calls.push({ context, input }); return { conversionId: input.conversionId, status: 'SUCCESS', attemptCount: 1, nextAttemptAt: null }; } } });
  const res = reply();
  await handler({ id: 'req-1', correlationId: 'corr-1', headers: { 'x-tenant-id': 'tenant-1', 'x-user-id': 'user-1', 'x-permissions': 'marketplace_acquisition.convert' }, params: { id: 'conv-1' } }, res);
  assert.equal(res.status, 200);
  assert.equal(res.payload.data.conversionId, 'conv-1');
  assert.equal(calls[0].context.tenantId, 'tenant-1');
  assert.equal(calls[0].input.tenantId, 'tenant-1');
});

test('manual render conversion retry endpoint requires auth and permission', async () => {
  const handler = createRenderConversionRetryHandler({ renderConversionRetry: { retryRenderConversion: async () => { throw new Error('should not call service'); } } });
  await assert.rejects(() => handler({ id: 'req-1', headers: { 'x-tenant-id': 'tenant-1', 'x-permissions': 'marketplace_acquisition.convert' }, params: { id: 'conv-1' } }, reply()), /Authenticated user is required/);
  await assert.rejects(() => handler({ id: 'req-1', headers: { 'x-tenant-id': 'tenant-1', 'x-user-id': 'user-1' }, params: { id: 'conv-1' } }, reply()), /permission is required/);
});
