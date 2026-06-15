import { prisma } from "@/lib/prisma";
import {
  PrismaAuditLogRepository,
  PrismaDealsRepository,
  PrismaDraftInventoryRepository,
  PrismaMarketplaceCaptureRepository,
  PrismaMarketplaceOwnershipAttestationRepository,
  PrismaPipelineRepository,
  type PrismaPersistenceClient,
} from "@whisperm/repositories";
import { SellerClaimPortalService, type ClaimTokenRecord, type ClaimTokenRepository } from "@whisperm/services";

const normalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalize(nested)]));
  return value;
};

const parseClaimToken = (value: unknown): ClaimTokenRecord => value as ClaimTokenRecord;

class PrismaClaimTokenRepository implements ClaimTokenRepository {
  constructor(private readonly client: PrismaPersistenceClient) {}

  async findByTokenHash(tokenHash: string): Promise<ClaimTokenRecord | null> {
    const row = await this.client.marketplaceClaimToken.findFirst({ where: { tokenHash } });
    return row === null ? null : parseClaimToken(normalize(row));
  }

  async update(context: { readonly tenantId: string }, tokenId: string, input: Partial<Pick<ClaimTokenRecord, "status" | "claimedAt" | "metadata">>): Promise<ClaimTokenRecord> {
    await this.client.marketplaceClaimToken.updateMany({ where: { tenantId: context.tenantId, id: tokenId }, data: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) });
    const row = await this.client.marketplaceClaimToken.findFirst({ where: { tenantId: context.tenantId, id: tokenId } });
    if (row === null) throw new Error("Claim token not found after update");
    return parseClaimToken(normalize(row));
  }
}

export const createSellerClaimService = (): SellerClaimPortalService => {
  const client = prisma as unknown as PrismaPersistenceClient;
  return new SellerClaimPortalService({
    claimTokens: new PrismaClaimTokenRepository(client),
    marketplaceCaptures: new PrismaMarketplaceCaptureRepository(client),
    draftInventories: new PrismaDraftInventoryRepository(client),
    ownershipAttestations: new PrismaMarketplaceOwnershipAttestationRepository(client),
    pipelines: new PrismaPipelineRepository(client),
    deals: new PrismaDealsRepository(client),
    auditLogs: new PrismaAuditLogRepository(client),
  });
};
