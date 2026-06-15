import { NextRequest, NextResponse } from "next/server";
import { ownershipClaimAcceptRequestSchema } from "@whisperm/types";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";
import { PrismaAuditLogRepository, PrismaDraftInventoryRepository, PrismaMarketplaceCaptureRepository, PrismaMarketplaceClaimTokenRepository, PrismaMarketplaceOwnershipAttestationRepository, type PrismaPersistenceClient } from "@whisperm/repositories";
import { OwnershipAttestationService, ServiceError } from "@whisperm/services";

interface RouteContext { readonly params: { readonly token: string } }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const body = form === null ? await request.json().catch(() => ({})) : Object.fromEntries(form.entries());
  const parsed = ownershipClaimAcceptRequestSchema.safeParse({ ...body, acceptedTerms: body.acceptedTerms === true || body.acceptedTerms === "true" });
  if (!parsed.success) return NextResponse.json({ error: "Claimant name and accepted attestation terms are required" }, { status: 400 });
  const client = prisma as unknown as PrismaPersistenceClient;
  const service = new OwnershipAttestationService({
    marketplaceCaptures: new PrismaMarketplaceCaptureRepository(client),
    draftInventories: new PrismaDraftInventoryRepository(client),
    marketplaceClaimTokens: new PrismaMarketplaceClaimTokenRepository(client),
    ownershipAttestations: new PrismaMarketplaceOwnershipAttestationRepository(client),
    auditLogs: new PrismaAuditLogRepository(client),
  } as unknown as ConstructorParameters<typeof OwnershipAttestationService>[0]);
  try {
    const result = await service.acceptClaim({ tenantId: tenant.id, correlation: { correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), requestId: request.headers.get("x-request-id") ?? undefined } }, { tenantId: tenant.id, token: params.token, ...parsed.data, ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? undefined, userAgent: request.headers.get("user-agent") ?? undefined });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Claim acceptance failed" }, { status: 500 });
  }
}
