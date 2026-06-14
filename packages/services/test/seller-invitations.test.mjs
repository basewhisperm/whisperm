import assert from "node:assert/strict";
import test from "node:test";

import { SellerInvitationService, ServiceError } from "../dist/index.js";

const now = "2026-06-14T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "actor-1", correlation: { correlationId: "corr-invite" } };

const createStore = () => ({ captures: new Map(), invitations: [], audits: [], sent: [], stageUpdates: [] });
const baseCapture = (overrides = {}) => ({ id: "capture-1", tenantId: "tenant-a", listingUrl: "https://market.example/listing/1", title: "Desk", status: "CAPTURED", dealId: "deal-1", capturedAt: now, createdAt: now, updatedAt: now, metadata: {}, ...overrides });

const deps = (store, options = {}) => ({
  marketplaceCaptures: {
    async findById(scope, id) { return store.captures.get(`${scope.tenantId}:${id}`) ?? null; },
    async update(scope, id, input) { const c = store.captures.get(`${scope.tenantId}:${id}`); assert.ok(c); const u = { ...c, ...input, updatedAt: now }; store.captures.set(`${scope.tenantId}:${id}`, u); return u; },
  },
  sellerInvitations: {
    async create(scope, input) { const row = { id: `invite-${store.invitations.length + 1}`, tenantId: scope.tenantId, ...input, createdAt: now, updatedAt: now }; store.invitations.push(row); return row; },
    async update(scope, id, input) { const idx = store.invitations.findIndex((row) => row.tenantId === scope.tenantId && row.id === id); assert.notEqual(idx, -1); store.invitations[idx] = { ...store.invitations[idx], ...input, updatedAt: now }; return store.invitations[idx]; },
  },
  pipelines: { async findByDefaultKey(tenantId) { return { id: "pipe-1", tenantId, stages: [{ id: "stage-invited", name: "Invited" }] }; } },
  deals: { async updateStage(workspaceId, dealId, stageId) { store.stageUpdates.push({ workspaceId, dealId, stageId }); return {}; } },
  auditLogs: { async append(scope, input) { store.audits.push({ tenantId: scope.tenantId, ...input }); return {}; } },
  notifications: { inviteBaseUrl: "https://app.example/invite", now: () => new Date(now), whatsappEnabled: options.whatsappEnabled, fallbackToSmsWhenWhatsappMissing: options.fallbackToSmsWhenWhatsappMissing, whatsapp: options.whatsapp, sms: options.sms, email: options.email },
});

const run = async (capture, options, input = {}) => { const store = createStore(); store.captures.set(`${capture.tenantId}:${capture.id}`, capture); const service = new SellerInvitationService(deps(store, options)); const result = await service.createSellerInvitation(context, { tenantId: "tenant-a", captureId: capture.id, ...input }); return { store, result }; };
const providers = (store) => ({ whatsapp: { async send(m) { store.sent.push(["WHATSAPP", m]); } }, sms: { async send(m) { store.sent.push(["SMS", m]); } }, email: { async send(m) { store.sent.push(["EMAIL", m]); } } });

test("phone + WhatsApp enabled chooses WHATSAPP", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), p); assert.equal(r.result.channel, "WHATSAPP"); assert.equal(r.result.status, "SENT"); });
test("phone without WhatsApp provider falls back to SMS if SMS is available", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), { sms: p.sms }); assert.equal(r.result.channel, "SMS"); assert.equal(r.store.audits.some((a) => a.action === "INVITATION_FALLBACK_USED"), true); });
test("phone only chooses SMS when WhatsApp is disabled", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), { whatsappEnabled: false, sms: p.sms }); assert.equal(r.result.channel, "SMS"); });
test("email only chooses EMAIL", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerEmail: "seller@example.com" } }), { email: p.email }); assert.equal(r.result.channel, "EMAIL"); });
test("phone + email chooses cellphone channel first", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { whatsappEnabled: false, sms: p.sms, email: p.email }); assert.equal(r.result.channel, "SMS"); });
test("missing phone and email fails clearly", async () => { await assert.rejects(run(baseCapture(), {}, {}), (e) => e instanceof ServiceError && e.message === "Seller has no reachable invitation channel."); });
test("preferredChannel EMAIL works when email exists", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { email: p.email }, { preferredChannel: "EMAIL" }); assert.equal(r.result.channel, "EMAIL"); });
test("preferredChannel WHATSAPP fails when phone missing", async () => { await assert.rejects(run(baseCapture({ metadata: { sellerEmail: "seller@example.com" } }), {}, { preferredChannel: "WHATSAPP" }), (e) => e instanceof ServiceError && e.message.includes("Seller phone")); });
test("invitation moves capture from Captured to Invited only after successful send", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerEmail: "seller@example.com" } }), { email: p.email }); assert.equal(r.store.captures.get("tenant-a:capture-1").status, "INVITED"); assert.equal(r.store.stageUpdates[0].stageId, "stage-invited"); });
test("tenant isolation preserved", async () => { const store = createStore(); store.captures.set("tenant-b:capture-1", baseCapture({ tenantId: "tenant-b" })); const service = new SellerInvitationService(deps(store, {})); await assert.rejects(service.createSellerInvitation(context, { tenantId: "tenant-a", captureId: "capture-1" }), (e) => e instanceof ServiceError && e.code === "SERVICE_NOT_FOUND"); });
