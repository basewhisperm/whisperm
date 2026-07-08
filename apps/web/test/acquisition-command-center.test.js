import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import ts from 'typescript';

// ST1-003: the funnel-math and non-mutation guarantees for AcquisitionCommandCenterService are
// already proven at the service layer (packages/services/test/acquisition-command-center.test.mjs).
// What was never proven is that the *route* actually reaches that real service and returns its
// output untouched. Previously this file only regex-matched the route/component source text --
// e.g. asserting the literal comment string "never mutate" appears in the service file, which
// proves nothing about runtime behavior. This harness transpiles and invokes the real route
// against fake repositories that have NO update/create methods at all, so any mutation attempt
// would throw immediately instead of silently passing a string match.

const tenantId = 'tenant-1';
const now = '2026-07-04T00:00:00.000Z';
let tempDir;
let route;
let NextRequestStub;

const campaign = (overrides = {}) => ({
  id: 'campaign-1', tenantId, name: 'Lagos Sellers', status: 'ACTIVE', currency: 'USD', metadata: {}, createdAt: now, updatedAt: now, ...overrides,
});
const member = (overrides = {}) => ({
  id: `member-${Math.random()}`, tenantId, campaignId: 'campaign-1', marketplaceCaptureId: `capture-${Math.random()}`, status: 'ADDED', dealId: null, contactId: null, assignedAt: now, createdAt: now, updatedAt: now, ...overrides,
});
const deal = (overrides = {}) => ({
  id: `deal-${Math.random()}`, tenantId, title: 'Deal', pipelineStageId: 'stage-1', currency: 'USD', value: null, closedAt: null, createdAt: now, updatedAt: now, ...overrides,
});

const sharedModuleReplacements = (dir) => (source) => source
  .replace(/from "next\/server"/gu, `from "${join(dir, 'next-server.mjs')}"`)
  .replace(/from "@\/lib\/get-tenant"/gu, `from "${join(dir, 'get-tenant.mjs')}"`)
  .replace(/from "@\/lib\/prisma"/gu, `from "${join(dir, 'prisma.mjs')}"`)
  .replace(/from "@\/lib\/tenant-features"/gu, `from "${join(dir, 'tenant-features.mjs')}"`)
  .replaceAll('from "@whisperm/repositories"', `from "${join(dir, 'repositories.mjs')}"`)
  .replaceAll('from "@whisperm/services"', `from "${import.meta.resolve('@whisperm/services')}"`);

before(async () => {
  tempDir = join(tmpdir(), `whisperm-command-center-route-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(join(tempDir, 'next-server.mjs'), [
    'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }',
    'export class NextRequest extends Request { get nextUrl() { return new URL(this.url); } }',
    '',
  ].join('\n'));
  writeFileSync(join(tempDir, 'get-tenant.mjs'), 'export const getTenantForCurrentUser = async () => globalThis.__commandCenterRouteTenant;\n');
  writeFileSync(join(tempDir, 'prisma.mjs'), 'export const prisma = {};\n');
  writeFileSync(join(tempDir, 'tenant-features.mjs'), 'export const requireSellerAcquisitionFeatureForApi = async () => globalThis.__commandCenterFeatureDenied ?? null;\n');
  // Deliberately no update/create/delete methods anywhere below: a mutation attempt fails loudly.
  writeFileSync(join(tempDir, 'repositories.mjs'), [
    'export class PrismaCampaignRuntimeExecutionRepository { constructor() { return globalThis.__commandCenterRepositories.executions; } }',
    'export const createPrismaRepositories = () => globalThis.__commandCenterRepositories;',
    '',
  ].join('\n'));

  ({ NextRequest: NextRequestStub } = await import(join(tempDir, 'next-server.mjs')));

  const routePath = new URL('../src/app/api/marketplace-acquisition/command-center/route.ts', import.meta.url).pathname;
  const source = sharedModuleReplacements(tempDir)(readFileSync(routePath, 'utf8'));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'command-center-route.mjs');
  writeFileSync(file, output);
  route = await import(file);
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const setState = ({ campaigns = [campaign()], members = [], executions = [], deals = [], claimTokens = {} } = {}) => {
  globalThis.__commandCenterRouteTenant = { id: tenantId };
  globalThis.__commandCenterFeatureDenied = null;
  globalThis.__commandCenterRepositories = {
    sellerAcquisitionCampaigns: {
      async list(context) { return { items: campaigns.filter((row) => row.tenantId === context.tenantId) }; },
      async findById(context, id) { return campaigns.find((row) => row.tenantId === context.tenantId && row.id === id) ?? null; },
      async listMembers(context, campaignId) { return { items: members.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) }; },
      // ST1-013E: AcquisitionMetricsService reads member counts through this, never `.length`.
      async countMembers(context, campaignId) { return members.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId).length; },
    },
    executions: { async listByCampaignId(context, campaignId) { return { items: executions.filter((row) => row.tenantId === context.tenantId && row.campaignId === campaignId) }; } },
    deals: { async findById(workspaceId, dealId) { return deals.find((row) => row.tenantId === workspaceId && row.id === dealId) ?? null; } },
    marketplaceClaimTokens: { async listClaimTokensByMarketplaceCaptureId(_context, captureId) { return claimTokens[captureId] ?? []; } },
    businessGrowthOpportunities: { async findByCampaignId() { return { items: [] }; } },
    // ST1-013E: AcquisitionMetricsService (via SellerAcquisitionRecordService) reads captures
    // through these -- deliberately no captures exist in this fixture, so it always resolves an
    // empty record set without needing every other repository SellerAcquisitionRecordService
    // could theoretically touch.
    marketplaceCaptures: {
      async list() { return { items: [] }; },
      async findById() { return null; },
    },
  };
};

const makeRequest = (query = '') => new NextRequestStub(`https://app.test/api/marketplace-acquisition/command-center${query}`);

test('unauthenticated requests never reach the service and get 401', async () => {
  setState();
  globalThis.__commandCenterRouteTenant = null;
  const response = await route.GET(makeRequest());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('feature-gated tenants never reach the service', async () => {
  setState();
  globalThis.__commandCenterFeatureDenied = Response.json({ ok: false, error: { message: 'feature disabled' } }, { status: 403 });
  const response = await route.GET(makeRequest());
  assert.equal(response.status, 403);
});

test('the route returns the real service snapshot, computed from canonical Contact+Deal linkage rather than a status label', async () => {
  const members = [
    member({ status: 'ADDED', contactId: 'contact-1', dealId: 'deal-1' }),
    member({ status: 'CONVERTED', dealId: null }),
  ];
  setState({ members, deals: [deal({ id: 'deal-1' })] });
  const response = await route.GET(makeRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.campaignId, 'campaign-1');
  assert.equal(body.data.funnel.crmConverted, 1, 'a real Contact+Deal pair counts, not the pipeline status label');
});

test('the route never mutates campaign, member, or deal state -- fake repositories expose no write methods, so a mutation attempt would throw, not silently pass', async () => {
  setState({ members: [member({ status: 'CLAIMED', marketplaceCaptureId: 'capture-9' })], claimTokens: { 'capture-9': [{ id: 'token-1' }] } });
  const response = await route.GET(makeRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.funnel.claimed, 1);
});

test('an explicit campaignId query param is threaded through to the service', async () => {
  const campaigns = [campaign({ id: 'campaign-1' }), campaign({ id: 'campaign-2', name: 'Second campaign' })];
  const members = [member({ campaignId: 'campaign-2', status: 'CLAIMED', marketplaceCaptureId: 'capture-7' })];
  setState({ campaigns, members, claimTokens: { 'capture-7': [{ id: 'token-1' }] } });
  const response = await route.GET(makeRequest('?campaignId=campaign-2'));
  const body = await response.json();
  assert.equal(body.data.campaignId, 'campaign-2');
  assert.equal(body.data.funnel.claimed, 1);
});

// The checks below are cheap structural smoke checks on the React component (does it render the
// funnel stages, the readiness-warning list, the empty state, etc.) -- unlike the tests above they
// are not claiming to prove golden-path truthfulness, just that the expected UI surface exists, so
// source-text matching is a reasonable, low-stakes tool here.
const component = readFileSync(new URL('../src/components/marketplace-acquisition/acquisition-command-center.tsx', import.meta.url), 'utf8');
const globalPage = readFileSync(new URL('../src/app/(app)/marketplace-acquisition/page.tsx', import.meta.url), 'utf8');
const workbenchComponent = readFileSync(new URL('../src/components/marketplace-acquisition/acquisition-workbench.tsx', import.meta.url), 'utf8');

test('component renders revenue funnel metrics', () => {
  assert.match(component, /funnelStages/u);
  assert.match(component, /Discovered/u);
  assert.match(component, /Qualified/u);
  assert.match(component, /Invited/u);
  assert.match(component, /Claimed/u);
  assert.match(component, /Converted to CRM/u);
  assert.match(component, /Deal created/u);
  assert.match(component, /Revenue attributed/u);
  assert.match(component, /snapshot\.funnel\[stage\.key\]/u);
});

test('component renders readiness warnings', () => {
  assert.match(component, /readinessWarnings/u);
  assert.match(component, /Production readiness/u);
  assert.match(component, /warning\.message/u);
});

test('component renders next best actions', () => {
  assert.match(component, /Next best actions/u);
  assert.match(component, /topActions/u);
  assert.match(component, /action\.workbenchHref/u);
  assert.match(component, /action\.description/u);
});

test('component handles the empty (no campaign) state without crashing', () => {
  assert.match(component, /hasCampaign/u);
  assert.match(component, /No campaign yet/u);
  assert.match(component, /Create a campaign/u);
});

test('component handles API failure with a visible error state', () => {
  assert.match(component, /\(fetchError: unknown\)/u);
  assert.match(component, /setError/u);
  assert.match(component, /role="alert"/u);
});

test('component never computes or filters tenant data client-side -- it only renders the server snapshot', () => {
  assert.doesNotMatch(component, /tenantId/u);
  assert.match(component, /fetch\(`\/api\/marketplace-acquisition\/command-center/u);
});

test('global marketplace-acquisition page mounts the command center above the workbench', () => {
  assert.match(globalPage, /AcquisitionCommandCenter/u);
  assert.match(globalPage, /<AcquisitionCommandCenter \/>/u);
  const commandCenterIndex = globalPage.indexOf('<AcquisitionCommandCenter');
  const workbenchIndex = globalPage.indexOf('<AcquisitionWorkbench');
  assert.ok(commandCenterIndex >= 0 && workbenchIndex >= 0 && commandCenterIndex < workbenchIndex, 'command center should render above the workbench');
});

test('campaign workbench links back to the command center', () => {
  assert.match(workbenchComponent, /Back to command center/u);
  assert.match(workbenchComponent, /href="\/marketplace-acquisition"/u);
});
