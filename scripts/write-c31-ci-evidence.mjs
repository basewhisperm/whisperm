import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const stages = ['migration', 'lint', 'bootstrap', 'typecheck', 'strictTypecheck', 'test', 'doctor', 'build'];
const checks = stages.map((name) => ({
  name,
  outcome: process.env[`C31_${name.toUpperCase()}_OUTCOME`] ?? 'unknown',
}));

const manifest = {
  schemaVersion: 'whisperm.c31.ci-evidence.v1',
  attemptId: process.env.C31_ATTEMPT_ID ?? 'C31-A01',
  predecessorAttemptId: 'C26-A01',
  repository: process.env.GITHUB_REPOSITORY ?? null,
  ref: process.env.GITHUB_REF ?? null,
  headCommit: process.env.GITHUB_SHA ?? null,
  workflow: process.env.GITHUB_WORKFLOW ?? null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  generatedAt: new Date().toISOString(),
  toolchain: {
    node: process.version,
    pnpm: process.env.C31_PNPM_VERSION ?? null,
  },
  checks,
};

const canonical = JSON.stringify(manifest);
const output = {
  ...manifest,
  manifestDigest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
};
mkdirSync('docs/traceability', { recursive: true });
writeFileSync('docs/traceability/c31-ci-evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output));
