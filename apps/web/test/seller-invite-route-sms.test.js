import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../src/app/api/marketplace-acquisition/captures/[id]/invite/route.ts', import.meta.url), 'utf8');

test('seller acquisition invite route wires the generic SMS provider from launch environment variables', () => {
  assert.match(route, /createHttpSmsProviderFromEnv/u);
  assert.match(route, /SELLER_INVITATION_SMS_PROVIDER/u);
  assert.match(route, /SELLER_INVITATION_SMS_API_URL/u);
  assert.match(route, /SELLER_INVITATION_SMS_API_KEY/u);
  assert.match(route, /SELLER_INVITATION_SMS_SENDER_ID/u);
  assert.match(route, /configuredSmsProvider/u);
  assert.match(route, /\.\.\.\(sms === undefined \? \{\} : \{ sms \}\)/u);
});

test('seller acquisition invite route keeps Resend email optional and avoids TrustLayer dependency', () => {
  assert.match(route, /configuredEmailProvider/u);
  assert.match(route, /RESEND_API_KEY/u);
  assert.doesNotMatch(route, /TrustLayer|trustLayer/u);
});
