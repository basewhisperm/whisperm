import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('../src/', import.meta.url));
const repoRoot = dirname(dirname(dirname(appRoot)));

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), 'utf8');
}

function collectFiles(directory, matcher, files = []) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectFiles(fullPath, matcher, files);
      continue;
    }
    if (matcher(fullPath)) files.push(fullPath);
  }
  return files;
}

test('English UI strings resolve from translation keys and miss safely', () => {
  const messages = JSON.parse(read('lib/i18n/en.json'));
  const source = read('lib/i18n/index.ts');

  assert.equal(messages['dashboard.title'], 'Dashboard');
  assert.equal(messages['contacts.create'], 'Create Contact');
  assert.equal(messages['reports.revenue'], 'Revenue');
  assert.match(source, /messages\[key\] \?\? key/u);
});

test('app shell UI strings use translation keys', () => {
  for (const file of ['components/app-shell/sidebar.tsx', 'components/app-shell/top-bar.tsx', 'app/page.tsx']) {
    const source = read(file);
    assert.match(source, /t\("[a-zA-Z0-9.]+"\)/u, file);
    assert.doesNotMatch(source, />Dashboard</u, file);
    assert.doesNotMatch(source, />Create Contact</u, file);
  }
});

test('audited code has no raw currency display concatenation', () => {
  const files = [
    ...collectFiles(join(appRoot), (file) => /\.(tsx|ts)$/u.test(file)),
    ...collectFiles(join(repoRoot, 'packages'), (file) => /\.(ts)$/u.test(file) && !file.includes('/node_modules/')),
  ];

  const rawCurrency = new RegExp("(?:[\"\']\\$(?!\\{)|[\"\'`](?:GHS|USD)\\s|\\+\\s*[\"\'`](?:GHS|USD|\\$)|[\"\'`](?:GHS|USD|\\$)[\"\'`]\\s*\\+)", "u");
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), rawCurrency, file);
  }
});
