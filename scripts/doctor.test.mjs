import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isParseablePostgresUrl, loadEnvFilesInto, parseEnvFile, runChecks, versionAtLeast } from "./doctor.mjs";

test("versionAtLeast compares major/minor/patch correctly", () => {
  assert.equal(versionAtLeast("v20.11.0", "20.11.0"), true);
  assert.equal(versionAtLeast("v20.11.1", "20.11.0"), true);
  assert.equal(versionAtLeast("v20.12.0", "20.11.0"), true);
  assert.equal(versionAtLeast("v21.0.0", "20.11.0"), true);
  assert.equal(versionAtLeast("v20.10.9", "20.11.0"), false);
  assert.equal(versionAtLeast("v18.19.0", "20.11.0"), false);
  assert.equal(versionAtLeast("not-a-version", "20.11.0"), false);
});

test("parseEnvFile ignores comments/blank lines and strips quotes", () => {
  const parsed = parseEnvFile([
    "# a comment",
    "",
    "DATABASE_URL=postgres://localhost/db",
    "QUOTED=\"hello world\"",
    "SINGLE='single quoted'",
    "NO_EQUALS_LINE_IS_IGNORED",
  ].join("\n"));

  assert.deepEqual(parsed, {
    DATABASE_URL: "postgres://localhost/db",
    QUOTED: "hello world",
    SINGLE: "single quoted",
  });
});

test("loadEnvFilesInto never overwrites a key already present in the target env", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));
  try {
    const filePath = path.join(dir, ".env");
    writeFileSync(filePath, "DATABASE_URL=postgres://from-file/db\nNEW_VAR=from-file\n");

    const env = { DATABASE_URL: "postgres://from-process-env/db" };
    loadEnvFilesInto(env, [filePath]);

    assert.equal(env.DATABASE_URL, "postgres://from-process-env/db");
    assert.equal(env.NEW_VAR, "from-file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isParseablePostgresUrl accepts postgres/postgresql, rejects garbage", () => {
  assert.equal(isParseablePostgresUrl("postgresql://user:pass@localhost:5432/db"), true);
  assert.equal(isParseablePostgresUrl("postgres://user:pass@localhost:5432/db"), true);
  assert.equal(isParseablePostgresUrl("not-a-url"), false);
  assert.equal(isParseablePostgresUrl("mysql://localhost/db"), false);
});

test("runChecks never includes an env var value, only names, in FAIL/WARN messages", () => {
  const secretValue = "postgresql://user:super-secret-password@localhost:5432/db";
  const results = runChecks({ DATABASE_URL: secretValue, REDIS_URL: undefined });
  for (const { message } of results) {
    assert.ok(!message.includes("super-secret-password"), `message leaked a secret value: ${message}`);
  }
});

test("runChecks FAILs when DATABASE_URL is missing, WARNs when REDIS_URL is missing", () => {
  const results = runChecks({});
  const byMessage = (substr) => results.find((r) => r.message.includes(substr));
  assert.equal(byMessage("DATABASE_URL is missing")?.level, "FAIL");
  assert.equal(byMessage("REDIS_URL missing")?.level, "WARN");
});

test("runChecks PASSes DATABASE_URL when set and parseable", () => {
  const results = runChecks({ DATABASE_URL: "postgresql://localhost:5432/db" });
  const entry = results.find((r) => r.message.startsWith("DATABASE_URL is set"));
  assert.equal(entry?.level, "PASS");
});
