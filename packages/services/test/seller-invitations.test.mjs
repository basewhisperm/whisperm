import assert from "node:assert/strict";
import test from "node:test";

import { SellerInvitationService, ServiceError, hashClaimToken } from "../dist/index.js";

const now = "2026-06-14T00:00:00.000Z";
const context = { tenantId: "tenant-a", actorId: "actor-1", correlation: { correlationId: "corr-invite" } };

const createStore = () => ({ captures: new Map(), invitations: [], claimTokens: [], audits: [], sent: [], stageUpdates: [], scheduledLifecycle: [] });
const baseCapture = (overrides = {}) => ({ id: "capture-1", tenantId: "tenant-a", listingUrl: "https://market.example/listing/1", title: "Desk", status: "CAPTURED", contactId: "contact-1", dealId: "deal-1", capturedAt: now, createdAt: now, updatedAt: now, metadata: {}, ...overrides });

const deps = (store, options = {}) => ({
  marketplaceCaptures: {
    async findById(scope, id) { return store.captures.get(`${scope.tenantId}:${id}`) ?? null; },
    async update(scope, id, input) { const c = store.captures.get(`${scope.tenantId}:${id}`); assert.ok(c); const u = { ...c, ...input, updatedAt: now }; store.captures.set(`${scope.tenantId}:${id}`, u); return u; },
  },
  marketplaceClaimTokens: {
    async create(scope, input) { const row = { id: `token-${store.claimTokens.length + 1}`, tenantId: scope.tenantId, status: "PENDING", ...input, createdAt: now, updatedAt: now }; store.claimTokens.push(row); return row; },
    async findByTokenHash(scope, tokenHash) { return store.claimTokens.find((row) => row.tenantId === scope.tenantId && row.tokenHash === tokenHash) ?? null; },
    async update(scope, id, input) { const idx = store.claimTokens.findIndex((row) => row.tenantId === scope.tenantId && row.id === id); assert.notEqual(idx, -1); store.claimTokens[idx] = { ...store.claimTokens[idx], ...input, updatedAt: now }; return store.claimTokens[idx]; },
  },
  sellerInvitations: {
    async create(scope, input) { const row = { id: `invite-${store.invitations.length + 1}`, tenantId: scope.tenantId, ...input, createdAt: now, updatedAt: now }; store.invitations.push(row); return row; },
    async update(scope, id, input) { const idx = store.invitations.findIndex((row) => row.tenantId === scope.tenantId && row.id === id); assert.notEqual(idx, -1); store.invitations[idx] = { ...store.invitations[idx], ...input, updatedAt: now }; return store.invitations[idx]; },
  },
  pipelines: { async findByDefaultKey(tenantId) { return { id: "pipe-1", tenantId, stages: [{ id: "stage-invited", name: "Invited" }] }; } },
  deals: { async updateStage(workspaceId, dealId, stageId) { store.stageUpdates.push({ workspaceId, dealId, stageId }); return {}; } },
  auditLogs: { async append(scope, input) { store.audits.push({ tenantId: scope.tenantId, ...input }); return {}; } },
  notifications: { inviteBaseUrl: options.inviteBaseUrl ?? "https://app.example/invite", now: () => new Date(now), whatsappEnabled: options.whatsappEnabled, fallbackToSmsWhenWhatsappMissing: options.fallbackToSmsWhenWhatsappMissing, whatsapp: options.whatsapp, sms: options.sms, email: options.email },
  claimLifecycleScheduler: options.claimLifecycleScheduler ?? { async scheduleClaimLifecycle(context, invitationId) { store.scheduledLifecycle.push({ context, invitationId }); return []; } },
});

const run = async (capture, options, input = {}) => { const store = createStore(); store.captures.set(`${capture.tenantId}:${capture.id}`, capture); const service = new SellerInvitationService(deps(store, options)); const result = await service.createSellerInvitation(context, { tenantId: "tenant-a", captureId: capture.id, ...input }); return { store, result }; };
const providers = (store) => ({ whatsapp: { async send(m) { store.sent.push(["WHATSAPP", m]); } }, sms: { async send(m) { store.sent.push(["SMS", m]); } }, email: { async send(m) { store.sent.push(["EMAIL", m]); } } });

test("phone + WhatsApp enabled chooses WHATSAPP", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), p); assert.equal(r.result.channel, "WHATSAPP"); assert.equal(r.result.status, "SENT"); });
test("phone without WhatsApp provider falls back to SMS if SMS is available", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), { sms: p.sms }); assert.equal(r.result.channel, "SMS"); assert.equal(r.store.audits.some((a) => a.action === "INVITATION_FALLBACK_USED"), true); });
test("preferredChannel WHATSAPP falls back to SMS when WhatsApp provider is missing", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), { sms: p.sms }, { preferredChannel: "WHATSAPP" }); assert.equal(r.result.channel, "SMS"); assert.equal(r.result.status, "SENT"); assert.equal(r.store.audits.some((a) => a.action === "INVITATION_FALLBACK_USED"), true); });
test("phone only chooses SMS when WhatsApp is disabled", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), { whatsappEnabled: false, sms: p.sms }); assert.equal(r.result.channel, "SMS"); });
test("email only is blocked because Seller Acquisition invitation requires phone-qualified contact", async () => { await assert.rejects(run(baseCapture({ contactId: "contact-1", metadata: { sellerEmail: "seller@example.com" } }), {}, {}), (e) => e instanceof ServiceError && e.code === "SERVICE_INVALID_STATE_TRANSITION" && e.details.missingRequirements.includes("PHONE_REQUIRED")); });
test("phone + email chooses cellphone channel first", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { whatsappEnabled: false, sms: p.sms, email: p.email }); assert.equal(r.result.channel, "SMS"); });
test("missing phone fails before invitation or claim token creation", async () => { const store = createStore(); const capture = baseCapture({ contactId: null }); store.captures.set(`${capture.tenantId}:${capture.id}`, capture); const service = new SellerInvitationService(deps(store, {})); await assert.rejects(service.createSellerInvitation(context, { tenantId: "tenant-a", captureId: capture.id }), (e) => e instanceof ServiceError && e.code === "SERVICE_INVALID_STATE_TRANSITION"); assert.equal(store.invitations.length, 0); assert.equal(store.claimTokens.length, 0); });
test("missing delivery providers persists failed invitation and claim token for operator visibility", async () => {
  const store = createStore();
  const capture = baseCapture({ metadata: { sellerPhone: "+233501234567" } });
  store.captures.set(`${capture.tenantId}:${capture.id}`, capture);
  const service = new SellerInvitationService(deps(store, {}));

  const result = await service.createSellerInvitation(context, { tenantId: "tenant-a", captureId: capture.id });

  assert.equal(result.status, "FAILED");
  assert.equal(result.channel, "WHATSAPP");
  assert.equal(store.claimTokens.length, 1);
  assert.equal(store.invitations.length, 1);
  assert.equal(store.invitations[0].status, "FAILED");
  assert.equal(store.audits.some((audit) => audit.action === "INVITATION_FAILED"), true);
});
test("preferredChannel EMAIL works when phone-qualified contact also has email", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ contactId: "contact-1", metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { email: p.email }, { preferredChannel: "EMAIL" }); assert.equal(r.result.channel, "EMAIL"); });
test("preferredChannel WHATSAPP fails when phone missing", async () => { await assert.rejects(run(baseCapture({ metadata: { sellerEmail: "seller@example.com" } }), {}, { preferredChannel: "WHATSAPP" }), (e) => e instanceof ServiceError && e.message.includes("Seller phone")); });
test("invitation moves capture from Captured to Invited only after successful send", async () => { const store = createStore(); const p = providers(store); const r = await run(baseCapture({ contactId: "contact-1", metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { email: p.email }, { preferredChannel: "EMAIL" }); assert.equal(r.store.captures.get("tenant-a:capture-1").status, "INVITED"); assert.equal(r.store.stageUpdates[0].stageId, "stage-invited"); });
test("tenant isolation preserved", async () => { const store = createStore(); store.captures.set("tenant-b:capture-1", baseCapture({ tenantId: "tenant-b" })); const service = new SellerInvitationService(deps(store, {})); await assert.rejects(service.createSellerInvitation(context, { tenantId: "tenant-a", captureId: "capture-1" }), (e) => e instanceof ServiceError && e.code === "SERVICE_NOT_FOUND"); });

test("successful invitation creates a resolvable claim token and /claim invite URL", async () => {
  const store = createStore();
  const p = providers(store);
  const r = await run(baseCapture({ contactId: "contact-1", metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { email: p.email, inviteBaseUrl: "https://app.example/claim" }, { preferredChannel: "EMAIL" });

  assert.equal(r.store.claimTokens.length, 1);
  assert.equal(r.store.claimTokens[0].marketplaceCaptureId, "capture-1");
  assert.equal(r.store.claimTokens[0].status, "SENT");

  const rawToken = new URL(r.result.inviteUrl).pathname.split("/").at(-1);
  assert.ok(rawToken);
  assert.equal(new URL(r.result.inviteUrl).pathname.startsWith("/claim/"), true);
  assert.equal(r.store.claimTokens[0].tokenHash, hashClaimToken(rawToken));
  assert.equal(r.store.invitations[0].metadata.claimTokenId, r.store.claimTokens[0].id);

  const expiresAt = Date.parse(r.store.claimTokens[0].expiresAt);
  assert.equal(expiresAt, Date.parse(now) + 7 * 24 * 60 * 60 * 1000);
});

test("WhatsApp provider failure falls back to SMS and records deterministic audit", async () => {
  const store = createStore();
  const p = providers(store);
  const r = await run(baseCapture({ metadata: { sellerPhone: "+233501234567" } }), {
    whatsapp: { async send() { throw new Error("provider down"); } },
    sms: p.sms,
  });

  assert.equal(r.result.channel, "SMS");
  assert.equal(r.result.status, "SENT");
  assert.equal(r.store.audits.some((a) => a.action === "INVITATION_FALLBACK_USED"), true);
  assert.equal(r.store.invitations[1].metadata.fallbackFrom, "WHATSAPP");
  assert.equal(r.store.invitations[1].metadata.providerOutcome, "DELIVERED");
});

test("provider delivery failure produces deterministic failure metadata", async () => {
  const store = createStore();
  const r = await run(baseCapture({ contactId: "contact-1", metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), {
    email: { async send() { throw new Error("provider down"); } },
  }, { preferredChannel: "EMAIL" });

  assert.equal(r.result.channel, "EMAIL");
  assert.equal(r.result.status, "FAILED");
  assert.equal(r.store.invitations[0].metadata.providerOutcome, "FAILED");
  assert.equal(r.store.invitations[0].metadata.failureReason, "INVITATION_PROVIDER_UNAVAILABLE");
  assert.equal(r.store.audits.some((a) => a.action === "INVITATION_FAILED"), true);
});


test("successful invitation schedules claim lifecycle jobs for the claim token", async () => {
  const store = createStore();
  const p = providers(store);
  const r = await run(baseCapture({ contactId: "contact-1", metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), { email: p.email }, { preferredChannel: "EMAIL" });

  assert.equal(r.result.status, "SENT");
  assert.equal(r.store.claimTokens.length, 1);
  assert.equal(r.store.scheduledLifecycle.length, 1);
  assert.equal(r.store.scheduledLifecycle[0].invitationId, r.store.claimTokens[0].id);
  assert.equal(r.store.scheduledLifecycle[0].context.tenantId, "tenant-a");
});

test("failed invitation does not schedule claim lifecycle jobs", async () => {
  const r = await run(baseCapture({ contactId: "contact-1", metadata: { sellerPhone: "+233501234567", sellerEmail: "seller@example.com" } }), {
    email: { async send() { throw new Error("provider down"); } },
  }, { preferredChannel: "EMAIL" });

  assert.equal(r.result.status, "FAILED");
  assert.equal(r.store.scheduledLifecycle.length, 0);
});
