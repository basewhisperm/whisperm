#!/usr/bin/env node
// WhispeRM Doctor -- ST1-013L: bootstrap/first-run environment validation.
//
// Checks the local toolchain, workspace layout, and environment configuration are sane enough
// to run WhispeRM, without ever printing a secret *value* (variable names only). Exits 0 when
// nothing FAILed (WARNs are allowed -- e.g. an unconfigured invitation provider is fine for a
// bootstrap check), non-zero when a required condition fails.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_NODE_VERSION = "20.11.0";

/** Parses a dotted `major.minor.patch` version string into three numbers. Ignores prerelease/build suffixes. */
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** True when `version` is >= `minimum` (both dotted version strings). */
export function versionAtLeast(version, minimum) {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  if (actual === null || required === null) return false;
  if (actual.major !== required.major) return actual.major > required.major;
  if (actual.minor !== required.minor) return actual.minor > required.minor;
  return actual.patch >= required.patch;
}

/** Minimal KEY=VALUE dotenv-style parser -- no dependency, only used to populate checks. */
export function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key !== "") values[key] = value;
  }
  return values;
}

/** Loads dotenv-style files into `env` without overwriting keys already present (process.env wins). */
export function loadEnvFilesInto(env, filePaths) {
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;
    const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
  }
}

const ENV_FILES = [
  path.join(ROOT, ".env"),
  path.join(ROOT, "apps/web/.env.local"),
  path.join(ROOT, "apps/web/.env"),
  path.join(ROOT, "apps/api/.env"),
  path.join(ROOT, "apps/worker/.env"),
];

export function detectPnpm() {
  try {
    const version = execFileSync("pnpm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

/** True when `value` looks like a syntactically valid postgres/postgresql connection string. */
export function isParseablePostgresUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

const REQUIRED_APP_DIRS = ["apps/web", "apps/api", "apps/worker"];

const WEB_AUTH_ENV_VARS = ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"];

export function runChecks(env) {
  const results = [];
  const record = (level, message) => results.push({ level, message });

  // --- Toolchain -----------------------------------------------------------------------------
  const nodeOk = versionAtLeast(process.version, REQUIRED_NODE_VERSION);
  record(nodeOk ? "PASS" : "FAIL", `Node version: ${process.version} (requires >= ${REQUIRED_NODE_VERSION})`);

  const pnpm = detectPnpm();
  record(pnpm.available ? "PASS" : "FAIL", pnpm.available ? `pnpm detected (${pnpm.version})` : "pnpm not found on PATH -- run `corepack enable`");

  // --- Workspace layout ------------------------------------------------------------------------
  record(existsSync(path.join(ROOT, "pnpm-workspace.yaml")) ? "PASS" : "FAIL", "pnpm-workspace.yaml present");
  record(existsSync(path.join(ROOT, "packages")) ? "PASS" : "FAIL", "packages/ workspace directory present");

  for (const appDir of REQUIRED_APP_DIRS) {
    const ok = existsSync(path.join(ROOT, appDir, "package.json"));
    record(ok ? "PASS" : "FAIL", `${appDir} exists`);
  }

  record(existsSync(path.join(ROOT, "prisma/schema.prisma")) ? "PASS" : "FAIL", "prisma/schema.prisma present");

  // --- Environment variables --------------------------------------------------------------------
  if (!env.DATABASE_URL) {
    record("FAIL", "DATABASE_URL is missing");
  } else if (!isParseablePostgresUrl(env.DATABASE_URL)) {
    record("FAIL", "DATABASE_URL is set but is not a parseable postgres:// / postgresql:// URL");
  } else {
    record("PASS", "DATABASE_URL is set and parseable");
  }

  if (!env.REDIS_URL) {
    record("WARN", "REDIS_URL missing; worker queue features may not run");
  } else {
    record("PASS", "REDIS_URL is set");
  }

  const missingAuthVars = WEB_AUTH_ENV_VARS.filter((name) => !env[name]);
  if (missingAuthVars.length > 0) {
    record("WARN", `${missingAuthVars.join(", ")} missing; apps/web sign-in will not work until these are set`);
  } else {
    record("PASS", "Clerk auth environment variables are set");
  }

  if (!env.SELLER_INVITATION_BASE_URL) {
    record("WARN", "SELLER_INVITATION_BASE_URL missing; seller invitation claim links cannot be generated");
  } else {
    record("PASS", "SELLER_INVITATION_BASE_URL is set");
  }

  return results;
}

function printReport(results) {
  console.log("WhispeRM Doctor\n");
  for (const { level, message } of results) {
    console.log(`${level.padEnd(4)} ${message}`);
  }

  const failCount = results.filter((r) => r.level === "FAIL").length;
  const warnCount = results.filter((r) => r.level === "WARN").length;
  console.log(`\n${results.length} checks: ${results.length - failCount - warnCount} passed, ${warnCount} warned, ${failCount} failed.`);
  return failCount;
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const env = { ...process.env };
  loadEnvFilesInto(env, ENV_FILES);
  const results = runChecks(env);
  const failCount = printReport(results);
  process.exit(failCount > 0 ? 1 : 0);
}
