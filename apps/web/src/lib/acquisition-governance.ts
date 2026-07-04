import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  createPrismaRepositories,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import {
  AcquisitionGovernanceService,
  type AcquisitionGovernanceAuthorizationInput,
  type AcquisitionGovernanceDecision,
} from "@whisperm/services";

// CS-022: single construction point for the governance service so API routes
// and worker job handlers never build their own ad hoc checks -- they all
// call AcquisitionGovernanceService.authorizeAcquisitionAction through here.
export const acquisitionGovernanceService = (): AcquisitionGovernanceService => {
  const persistence = prisma as unknown as PrismaPersistenceClient;
  const repositories = createPrismaRepositories(persistence);
  return new AcquisitionGovernanceService({
    governance: repositories.acquisitionGovernance,
    campaigns: repositories.sellerAcquisitionCampaigns,
    auditLogs: repositories.auditLogs,
  });
};

const statusForDenial = (decision: AcquisitionGovernanceDecision): number => {
  switch (decision.reason) {
    case "TENANT_MISMATCH":
      return 404;
    case "PROVIDER_REQUIRED":
    case "CAMPAIGN_NOT_ACTIVE":
      return 409;
    case "MONTHLY_QUOTA_EXCEEDED":
    case "DAILY_RATE_LIMIT_EXCEEDED":
      return 429;
    case "FEATURE_DISABLED":
    case "TENANT_INACTIVE":
    case "PLAN_LIMIT_EXCEEDED":
    default:
      return 403;
  }
};

export interface AcquisitionGovernanceApiResult {
  readonly decision: AcquisitionGovernanceDecision;
  readonly denied: NextResponse | null;
}

/**
 * Authorizes a runtime-triggering acquisition action for an API route.
 * Returns a ready-to-return NextResponse when the action is denied so the
 * calling route can `if (denied) return denied;` and otherwise proceed.
 */
export async function authorizeAcquisitionActionForApi(
  tenantId: string,
  input: AcquisitionGovernanceAuthorizationInput,
): Promise<AcquisitionGovernanceApiResult> {
  const decision = await acquisitionGovernanceService().authorizeAcquisitionAction({ tenantId }, input);
  if (decision.status === "DENY") {
    return {
      decision,
      denied: NextResponse.json(
        { ok: false, error: { message: decision.message, code: decision.reason ?? "GOVERNANCE_DENIED" } },
        { status: statusForDenial(decision) },
      ),
    };
  }
  return { decision, denied: null };
}
