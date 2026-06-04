import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const appRoot = join(webRoot, 'src');

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

function relativeToWeb(file) {
  return relative(webRoot, file);
}

function luminance(hex) {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );

  return (lighter + 0.05) / (darker + 0.05);
}

test('brand and interaction color tokens meet WCAG AA text contrast', () => {
  const minimumAaContrast = 4.5;

  assert.ok(contrastRatio('#534AB7', '#F1EFE8') >= minimumAaContrast);
  assert.ok(contrastRatio('#534AB7', '#FFFFFF') >= minimumAaContrast);
  assert.ok(contrastRatio('#1A1A2E', '#F1EFE8') >= minimumAaContrast);
  assert.ok(contrastRatio('#1A1A2E', '#7F77DD') >= minimumAaContrast);

  const globals = read('app/globals.css');
  const button = read('components/ui/button.tsx');
  const tailwind = readFileSync(join(webRoot, 'tailwind.config.ts'), 'utf8');

  assert.match(globals, /--color-primary-hover:/);
  assert.match(tailwind, /hover: "var\(--color-primary-hover\)"/);
  assert.match(button, /hover:bg-primary-hover/);
});

test('interactive shell controls expose visible keyboard focus states', () => {
  const appShell = read('components/app-shell/app-shell.tsx');
  const sidebar = read('components/app-shell/sidebar.tsx');
  const button = read('components/ui/button.tsx');

  assert.match(appShell, /Skip to main content/);
  assert.match(appShell, /href="#main-content"/);
  assert.match(sidebar, /focus-visible:ring-2/);
  assert.match(button, /focus-visible:ring-2/);
});

test('Tabler icons are explicitly hidden from assistive tech unless their control is labelled', () => {
  const componentFiles = collectFiles(join(appRoot, 'components'), (file) =>
    /\.tsx$/.test(file),
  );

  for (const file of componentFiles) {
    const source = readFileSync(file, 'utf8');
    const iconUsages = source.match(/<Icon[A-Z][^>]*>|<Icon\b[^>]*>/g) ?? [];

    for (const iconUsage of iconUsages) {
      assert.match(
        iconUsage,
        /aria-hidden="true"|aria-label=/,
        `${relativeToWeb(file)}: ${iconUsage}`,
      );
    }
  }

  assert.match(read('components/app-shell/top-bar.tsx'), /aria-label="Notifications"/);
});

test('health status indicator provides non-color status text', () => {
  const healthStatus = read('components/ui/health-status.tsx');

  assert.match(healthStatus, /aria-label=\{accessibleStatus\}/);
  assert.match(healthStatus, /Health status:/);
  assert.match(healthStatus, /Last touched/);
  assert.match(healthStatus, /role="img"/);
  assert.match(healthStatus, /green:/);
  assert.match(healthStatus, /amber:/);
  assert.match(healthStatus, /red:/);
});

test('implemented frontend text sizing never drops below the 11px minimum', () => {
  const sourceFiles = collectFiles(appRoot, (file) => /\.(css|tsx|ts)$/.test(file));
  const arbitraryTextSize = /text-\[(\d+(?:\.\d+)?)px\]/g;
  const cssFontSize = /font-size:\s*(\d+(?:\.\d+)?)px/g;

  for (const file of sourceFiles) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(arbitraryTextSize)) {
      assert.ok(Number(match[1]) >= 11, `${relativeToWeb(file)}: ${match[0]}`);
    }

    for (const match of source.matchAll(cssFontSize)) {
      assert.ok(Number(match[1]) >= 11, `${relativeToWeb(file)}: ${match[0]}`);
    }
  }

  assert.doesNotMatch(
    sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n'),
    /text-\[(?:\d|10(?:\.\d+)?)px\]/,
  );
});
