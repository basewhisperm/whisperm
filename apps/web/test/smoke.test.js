import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const appRoot = fileURLToPath(new URL('../src/', import.meta.url));

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

    if (matcher(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

test('brand tokens are centralized in global CSS and exposed to Tailwind', () => {
  const globals = read('app/globals.css');
  const tailwind = readFileSync(new URL('../tailwind.config.ts', import.meta.url), 'utf8');

  for (const token of ['midnight', 'whisper', 'pulse', 'mist', 'growth', 'ivory']) {
    assert.match(globals, new RegExp(`--color-${token}:`));
    assert.match(tailwind, new RegExp(`${token}: "var\\(--color-${token}\\)"`));
  }

  assert.match(globals, /--border-width-hairline: 0\.5px;/);
  assert.match(tailwind, /hairline: "var\(--border-width-hairline\)"/);
});

test('components do not hardcode hex colors', () => {
  const componentFiles = collectFiles(join(appRoot, 'components'), (file) =>
    /\.(tsx|ts|css)$/.test(file),
  );
  const hexColor = /#[0-9a-fA-F]{3,8}\b/;

  for (const file of componentFiles) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), hexColor, file);
  }
});
