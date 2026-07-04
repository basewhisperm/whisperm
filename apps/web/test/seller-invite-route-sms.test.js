import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import ts from 'typescript';

// ST1-003: invitationExecutionResponse is the seam that turns a CampaignRuntimeExecutionRecord
// (already proven truthful at the service layer by packages/services/test/campaign-runtime.test.mjs
// and seller-invitations.test.mjs) into the HTTP response the seller-invite route returns. This
// exercises the real mapping function end to end instead of asserting on route source text, so a
// regression that maps QUEUED/RUNNING to a false "COMPLETED", or a delivery FAILED to a 200, would
// actually fail this test rather than silently pass a string-match check.

let tempDir;
let invitationExecutionResponse;

before(async () => {
  tempDir = join(tmpdir(), `whisperm-invite-response-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir);
  writeFileSync(
    join(tempDir, 'next-server.mjs'),
    'export class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }\n',
  );

  const sourcePath = new URL('../src/lib/marketplace-acquisition/invitation-execution-response.ts', import.meta.url).pathname;
  const source = readFileSync(sourcePath, 'utf8').replace('from "next/server"', `from "${join(tempDir, 'next-server.mjs')}"`);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(tempDir, 'invitation-execution-response.mjs');
  writeFileSync(file, output);
  ({ invitationExecutionResponse } = await import(file));
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const execution = (overrides) => ({
  id: 'execution-1',
  tenantId: 'tenant-1',
  campaignId: 'campaign-1',
  status: 'COMPLETED',
  metrics: {},
  errorCode: null,
  errorMessage: null,
  ...overrides,
});

test('a real completed dispatch returns ok:true, status COMPLETED, 200', async () => {
  const response = invitationExecutionResponse(execution({ status: 'COMPLETED', metrics: { invitationId: 'invitation-1', channel: 'WHATSAPP' } }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.status, 'COMPLETED');
  assert.equal(body.data.invitationId, 'invitation-1');
  assert.equal(body.data.channel, 'WHATSAPP');
});

test('a genuine delivery failure returns ok:false with the real error code, never a 200', async () => {
  const response = invitationExecutionResponse(execution({ status: 'FAILED', errorCode: 'SERVICE_PROVIDER_UNAVAILABLE', errorMessage: 'No provider configured' }));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'SERVICE_PROVIDER_UNAVAILABLE');
  assert.equal(body.error.message, 'No provider configured');
});

test('an unrecognized failure code still fails closed with a non-2xx status', async () => {
  const response = invitationExecutionResponse(execution({ status: 'FAILED', errorCode: 'SOMETHING_UNEXPECTED' }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.ok, false);
});

test('genuinely in-flight work (QUEUED) is reported as PENDING with 202, never COMPLETED', async () => {
  const response = invitationExecutionResponse(execution({ status: 'QUEUED', metrics: { invitationId: 'invitation-2', selectedChannel: 'SMS' } }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.data.status, 'PENDING');
  assert.equal(body.data.channel, 'SMS');
});

test('a retry scheduled after a transient failure (RUNNING) is also reported as PENDING, not COMPLETED', async () => {
  const response = invitationExecutionResponse(execution({ status: 'RUNNING' }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.data.status, 'PENDING');
});
