import { NextResponse } from "next/server";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import {
  createPrismaRepositories,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { AcquisitionGovernanceService } from "@whisperm/services";

const errorResponse = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status });

// CS-022: thin read-model route -- computation lives entirely in
// AcquisitionGovernanceService, which centralizes tenant/feature/plan/quota/
// provider checks. This route only authenticates and delegates; it never
// gates on the seller-acquisition feature flag itself, because the snapshot
// must remain available (with a DISABLED overall status) so the UI can show
// a useful disabled state instead of a bare 403.
const governanceService = () => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(persistence);
  return new AcquisitionGovernanceService({
    governance: repositories.acquisitionGovernance,
    campaigns: repositories.sellerAcquisitionCampaigns,
    auditLogs: repositories.auditLogs,
  });
};

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return errorResponse("Unauthorized", 401);

  try {
    const snapshot = await governanceService().getGovernanceSnapshot({ tenantId: tenant.id });
    return NextResponse.json({ ok: true, data: snapshot });
  } catch {
    return errorResponse("Failed to load acquisition governance.", 500);
  }
}
