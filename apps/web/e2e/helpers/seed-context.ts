import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AcquisitionSeedContext {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly runId: string;
}

// Anchored on this file's own location (not process.cwd()): cwd depends on how `playwright
// test` was invoked (repo root, apps/web, CI, an IDE runner) and isn't guaranteed to be
// apps/web, but this file always lives at apps/web/e2e/helpers regardless of invocation --
// same fix rationale as global-setup.ts, which anchors on Playwright's own `config.rootDir`
// (both resolve to apps/web in this repo layout).
const SEED_CONTEXT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".e2e-seed.json");

// ST1-011: read-back for the fixture global-setup.ts writes. Returns null (rather than
// throwing) when absent so specs can `test.skip()` consistently with the existing
// E2E_USER_EMAIL/PASSWORD convention instead of failing hard when credentials aren't configured.
export function readAcquisitionSeedContext(): AcquisitionSeedContext | null {
  if (!existsSync(SEED_CONTEXT_PATH)) return null;
  return JSON.parse(readFileSync(SEED_CONTEXT_PATH, "utf8")) as AcquisitionSeedContext;
}
