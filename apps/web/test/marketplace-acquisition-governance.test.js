import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// ST1-010: apps/web/test/acquisition-governance.test.js previously only regex-matched the
// governance route/service source text. It could not catch a regression where the route stops
// authenticating, hard-gates the snapshot behind the feature flag (defeating the whole point of a
// snapshot that must stay visible in a DISABLED state), or where a governance-service failure leaks
// as a 200. This harness transpiles and invokes the real governance route against a fake
// AcquisitionGovernanceRepository so those regressions actually fail the test.

const tenantId = 'tenant-1';

const governanceRepo = (state) => ({
  async getTenantStatus() { return state.tenantStatus; },
  async hasActiveProvider() { return state.whatsappConfigured; },
  async hasActiveDiscoverySource() { return state.discoveryConfigured; },
  async countUsageSince() { return { discoveryRuns: 0, invitationsSent: 0 }; },
});

const campaignsRepo = () => ({ async findById() { return null; } });
const auditLogsRepo = (state) => ({ async append(scope, input) { state.auditLogs.push(input); return { id: `audit-${state.auditLogs.length}`, ...input }; } });
const usageEventsRepo = () => ({ async summarizeByTenantAndPeriod() { return { totals: [] }; } });

const servicesUrl = import.meta.resolve('@whisperm/services');

const transpileRoute = (routePath, tempDir) => {
  const source = readFileSync(routePath, 'utf8')
    .replace(/from "next\/server"/gu, `from "${join(tempDir, 'next-server.mjs')}"`)
    .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(tempDir, 'get-tenant.mjs')}"`)
    .replace(/from "@\/lib\/prisma"/gu, `from "${join(tempDir, 'prisma.mjs')}"`)
    .replace(/from "@\/lib\/marketplace-acquisition\/shared-provider-readiness"/gu, `from "${join(tempDir, 'shared-provider-readiness.mjs')}"`)
    .replaceAll('from "@whisperm/repositories"', `from "${join(tempDir, 'repositories.mjs')}"`)
    .replaceAll('from "@whisperm/services"', `from "${servicesUrl}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'governance-route.mjs');
  writeFileSync(file, output);
  return import(file);
};

const createHarness = async (state) => {
  const tempDir = join(tmpdir(), `whisperm-governance-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), 'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\n');
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__governanceRouteState.tenant;\n');
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'shared-provider-readiness.mjs'), 'export const sharedInvitationProviderReady = () => globalThis.__governanceRouteState.whatsappConfigured;\n');
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export const createPrismaRepositories = () => ({',
    '  acquisitionGovernance: globalThis.__governanceRouteRepos.governance,',
    '  sellerAcquisitionCampaigns: globalThis.__governanceRouteRepos.campaigns,',
    '  auditLogs: globalThis.__governanceRouteRepos.auditLogs,',
    '  acquisitionUsageEvents: globalThis.__governanceRouteRepos.usageEvents,',
    '});',
  ].join('\n'));
  globalThis.__governanceRouteState = state;
  globalThis.__governanceRouteRepos = {
    governance: governanceRepo(state),
    campaigns: campaignsRepo(state),
    auditLogs: auditLogsRepo(state),
    usageEvents: usageEventsRepo(state),
  };
  const base = new URL('../src/app/api/marketplace-acquisition/governance/route.ts', import.meta.url).pathname;
  return {
    cleanup: () => { delete globalThis.__governanceRouteState; delete globalThis.__governanceRouteRepos; rmSync(tempDir, { recursive: true, force: true }); },
    route: await transpileRoute(base, tempDir),
  };
};

const makeState = () => ({
  tenant: { id: tenantId },
  auditLogs: [],
  tenantStatus: { featureEnabled: true, discoveryFeatureEnabled: true, planName: 'GROWTH', subscriptionStatus: null },
  whatsappConfigured: true,
  discoveryConfigured: true,
});

test('unauthenticated requests never reach the service and get 401', async () => {
  const state = makeState();
  state.tenant = null;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET();
    assert.equal(response.status, 401);
  } finally {
    harness.cleanup();
  }
});

test('an active, fully-configured tenant gets an ACTIVE overall status with real capability data', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET();
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.data.tenantId, tenantId);
    assert.equal(body.data.overallStatus, 'ACTIVE');
    assert.equal(body.data.featureEnabled, true);
    assert.equal(body.data.capabilities.INVITATION.enabled, true);
  } finally {
    harness.cleanup();
  }
});

test('the snapshot is still returned (never hard-gated) when the feature is disabled -- it reports DISABLED instead of a bare 403', async () => {
  const state = makeState();
  state.tenantStatus = { ...state.tenantStatus, featureEnabled: false };
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.overallStatus, 'DISABLED');
    assert.equal(body.data.featureEnabled, false);
    assert.equal(body.data.capabilities.INVITATION.status, 'BLOCKED');
  } finally {
    harness.cleanup();
  }
});

test('an unconfigured provider surfaces as ACTION_REQUIRED with a real warning, not silently ACTIVE', async () => {
  const state = makeState();
  state.whatsappConfigured = false;
  const harness = await createHarness(state);
  try {
    const response = await harness.route.GET();
    const body = await response.json();
    assert.equal(body.data.overallStatus, 'ACTION_REQUIRED');
    assert.ok(body.data.warnings.some((w) => w.code === 'WHATSAPP_NOT_CONFIGURED'));
  } finally {
    harness.cleanup();
  }
});

test('a governance-repository failure returns a safe 500 rather than a false 200', async () => {
  const state = makeState();
  const harness = await createHarness(state);
  globalThis.__governanceRouteRepos.governance.getTenantStatus = async () => { throw new Error('boom'); };
  try {
    const response = await harness.route.GET();
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    harness.cleanup();
  }
});
