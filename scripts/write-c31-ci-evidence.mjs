import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const outputDir = 'docs/traceability';
const mode = process.env.C31_EVIDENCE_MODE ?? 'manifest';

mkdirSync(outputDir, { recursive: true });

if (mode === 'receipt') {
  const manifestText = readFileSync(`${outputDir}/c31-ci-evidence.json`, 'utf8');
  const receipt = {
    schemaVersion: 'whisperm.c31.ci-evidence-receipt.v1',
    attemptId: process.env.C31_ATTEMPT_ID ?? 'C31-A02',
    repository: process.env.GITHUB_REPOSITORY ?? null,
    sourceHeadCommit: process.env.C31_SOURCE_HEAD_SHA ?? null,
    baseCommit: process.env.C31_BASE_SHA ?? null,
    testedMergeCommit: process.env.GITHUB_SHA ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    evidenceManifestDigest: digest(manifestText),
    evidenceUpload: {
      outcome: process.env.C31_EVIDENCE_UPLOAD_OUTCOME ?? 'unknown',
      artifactId: process.env.C31_ARTIFACT_ID ?? null,
      artifactUrl: process.env.C31_ARTIFACT_URL ?? null,
      artifactDigest: process.env.C31_ARTIFACT_DIGEST ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
  const canonical = JSON.stringify(receipt);
  const output = { ...receipt, receiptDigest: digest(canonical) };
  writeFileSync(`${outputDir}/c31-ci-evidence-receipt.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
} else {
  const stages = ['install', 'migration', 'lint', 'bootstrap', 'typecheck', 'strictTypecheck', 'test', 'doctor', 'build'];
  const checks = stages.map((name) => ({
    name,
    outcome: process.env[`C31_${name.toUpperCase()}_OUTCOME`] ?? 'unknown',
  }));
  const manifest = {
    schemaVersion: 'whisperm.c31.ci-evidence.v2',
    attemptId: process.env.C31_ATTEMPT_ID ?? 'C31-A02',
    predecessorAttemptId: 'C31-A01',
    repository: process.env.GITHUB_REPOSITORY ?? null,
    ref: process.env.GITHUB_REF ?? null,
    sourceHeadCommit: process.env.C31_SOURCE_HEAD_SHA ?? null,
    baseCommit: process.env.C31_BASE_SHA ?? null,
    testedMergeCommit: process.env.GITHUB_SHA ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    generatedAt: new Date().toISOString(),
    toolchain: {
      node: process.version,
      pnpm: process.env.C31_PNPM_VERSION ?? null,
    },
    checks,
    evidenceGenerationOutcome: 'success',
  };
  const canonical = JSON.stringify(manifest);
  const output = { ...manifest, manifestDigest: digest(canonical) };
  writeFileSync(`${outputDir}/c31-ci-evidence.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
}
