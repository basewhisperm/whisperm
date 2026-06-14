import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/(app)/marketplace-acquisition/[dealId]/page.tsx', import.meta.url), 'utf8');

test('marketplace acquisition deal detail renders the required activity empty state', () => {
  assert.match(source, /No activity yet for this acquisition opportunity\./u);
});

test('marketplace acquisition activity timeline uses deal detail activity and does not render metadata blobs', () => {
  assert.match(source, /findDetailById\(tenant\.id, params\.dealId\)/u);
  assert.match(source, /<ActivityTimeline activities=\{detail\.activity\}/u);
  assert.doesNotMatch(source, /activity\.metadata/u);
});
