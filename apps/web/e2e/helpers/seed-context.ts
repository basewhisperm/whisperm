import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AcquisitionSeedContext {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly runId: string;
}

// Anchored on process.cwd() rather than __dirname/import.meta.url -- see global-setup.ts.
const SEED_CONTEXT_PATH = path.join(process.cwd(), "e2e", ".e2e-seed.json");

// ST1-011: read-back for the fixture global-setup.ts writes. Returns null (rather than
// throwing) when absent so specs can `test.skip()` consistently with the existing
// E2E_USER_EMAIL/PASSWORD convention instead of failing hard when credentials aren't configured.
export function readAcquisitionSeedContext(): AcquisitionSeedContext | null {
  if (!existsSync(SEED_CONTEXT_PATH)) return null;
  return JSON.parse(readFileSync(SEED_CONTEXT_PATH, "utf8")) as AcquisitionSeedContext;
}
