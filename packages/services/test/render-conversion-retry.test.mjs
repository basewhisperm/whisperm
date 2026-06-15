import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderConversionRetryService, nextRenderConversionRetryAt } from '../dist/render-conversion-retry.js';

const now = '2026-01-01T00:00:00.000Z';
const context = { tenantId: 'tenant-1', actorId: 'user-1', correlation: { correlationId: 'corr-1' } };
const capture = (overrides = {}) => ({ id: 'capture-1', tenantId: 'tenant-1', status: 'CLAIMED', contactId: 'contact-1', dealId: 'deal-1', sellerName: 'Seller One', sellerProfileUrl: null, externalId: 'market-1', listingUrl: 'https://market/listing', metadata: { sellerPhone: '+15555550123', marketplaceSource: 'MARKET_TEST' }, createdAt: now, updatedAt: now, ...overrides });
const draft = (overrides = {}) => ({ id: 'draft-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', dealId: 'deal-1', title: 'Draft item', status: 'CLAIMED', createdAt: now, updatedAt: now, ...overrides });
const conversion = (overrides = {}) => ({ id: 'conv-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', sellerVerificationId: 'verify-1', contactId: 'contact-1', dealId: 'deal-1', externalId: null, renderSellerId: null, conversionKind: 'SELLER', status: 'FAILED', attemptCount: 0, maxAttempts: 3, nextAttemptAt: null, lastAttemptAt: null, startedAt: now, completedAt: null, failedAt: now, failureReason: 'provider down', failureCode: null, deadLetteredAt: null, convertedAt: null, metadata: {}, createdAt: now, updatedAt: now, ...overrides });

const deps = (options = {}) => {
  const state = { conversion: options.conversion ?? conversion(), audits: [], sellerCalls: [], inventoryCalls: [] };
  const service = new RenderConversionRetryService({
    clock: () => new Date(now),
    marketplaceCaptures: { findById: async (_ctx, id) => id === 'capture-1' ? (options.capture ?? capture()) : null },
    draftInventories: { findByMarketplaceCaptureId: async () => options.draft ?? draft() },
    marketplaceSellerVerifications: { findLatestByMarketplaceCaptureId: async () => ({ id: 'verify-1', tenantId: 'tenant-1', marketplaceCaptureId: 'capture-1', contactId: 'contact-1', status: 'VERIFIED', createdAt: now, updatedAt: now }) },
    contacts: { findById: async () => ({ id: 'contact-1', tenantId: 'tenant-1', firstName: 'Seller', lastName: 'One', email: 'seller@example.com', phone: '+15555550123', stage: 'PROSPECT', createdAt: now, updatedAt: now }) },
    auditLogs: { append: async (_ctx, input) => { state.audits.push(input); return { id: `audit-${state.audits.length}`, ...input, createdAt: now }; } },
    renderConversions: {
      findById: async (_ctx, id) => id === state.conversion.id ? state.conversion : null,
      findSuccessfulSellerConversion: async () => options.duplicateSeller ?? null,
      findSuccessfulInventoryConversion: async () => options.duplicateInventory ?? null,
      update: async (_ctx, _id, input) => { state.conversion = { ...state.conversion, ...input, updatedAt: now }; return state.conversion; },
      create: async () => { throw new Error('retry must not create conversion records'); },
    },
    sellerConnector: { createRenderSeller: async (input) => { state.sellerCalls.push(input); if (options.failSeller) throw new Error('provider down'); return { renderSellerId: 'render-seller-1', status: 'CREATED' }; } },
    inventoryConnector: { createRenderInventory: async (input) => { state.inventoryCalls.push(input); if (options.failInventory) throw new Error('inventory down'); return { renderInventoryId: 'render-inventory-1', status: 'CREATED' }; } },
  });
  return { service, state };
};

test('failed seller conversion is retryable and success updates existing record', async () => { const s = deps(); const result = await s.service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }); assert.equal(result.status, 'SUCCESS'); assert.equal(result.attemptCount, 1); assert.equal(s.state.sellerCalls.length, 1); assert.equal(s.state.conversion.renderSellerId, 'render-seller-1'); assert.equal(s.state.audits.some((a) => a.action === 'RENDER_CONVERSION_RETRY_SUCCEEDED'), true); });
test('failed inventory conversion is retryable', async () => { const s = deps({ conversion: conversion({ conversionKind: 'INVENTORY', externalId: 'draft-1' }) }); const result = await s.service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }); assert.equal(result.status, 'SUCCESS'); assert.equal(s.state.inventoryCalls.length, 1); });
test('successful and dead-lettered conversions are not retried', async () => { await assert.rejects(() => deps({ conversion: conversion({ status: 'SUCCESS' }) }).service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }), /Only failed/); await assert.rejects(() => deps({ conversion: conversion({ status: 'DEAD_LETTERED' }) }).service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }), /Only failed/); });
test('expired acquisition conversion is not retried', async () => { await assert.rejects(() => deps({ capture: capture({ status: 'EXPIRED' }) }).service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }), /not eligible/); });
test('retry failure schedules deterministic backoff and max attempts dead-letters', async () => { const s = deps({ failSeller: true }); const failed = await s.service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }); assert.equal(failed.status, 'FAILED'); assert.equal(failed.nextAttemptAt, '2026-01-01T00:05:00.000Z'); const d = deps({ failSeller: true, conversion: conversion({ attemptCount: 2, maxAttempts: 3 }) }); const dead = await d.service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }); assert.equal(dead.status, 'DEAD_LETTERED'); });
test('backoff helper is deterministic', () => { assert.equal(nextRenderConversionRetryAt(1, new Date(now)), '2026-01-01T00:05:00.000Z'); assert.equal(nextRenderConversionRetryAt(2, new Date(now)), '2026-01-01T00:30:00.000Z'); assert.equal(nextRenderConversionRetryAt(3, new Date(now)), '2026-01-01T02:00:00.000Z'); });
test('tenant isolation and duplicate success prevent provider calls', async () => { await assert.rejects(() => deps().service.retryRenderConversion({ ...context, tenantId: 'tenant-2' }, { tenantId: 'tenant-1', conversionId: 'conv-1' }), /tenant/); const duplicate = conversion({ id: 'conv-success', status: 'SUCCESS', renderSellerId: 'existing' }); const s = deps({ duplicateSeller: duplicate }); await assert.rejects(() => s.service.retryRenderConversion(context, { tenantId: 'tenant-1', conversionId: 'conv-1' }), /Successful conversion already exists/); assert.equal(s.state.sellerCalls.length, 0); });
