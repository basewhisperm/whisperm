import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { PrismaDealsRepository, PrismaPipelineRepository, type DealRecord } from "@whisperm/repositories";

const pipelineDefaultKeyPattern = /^[a-z0-9_:-]{1,80}$/u;

function parsePipelineDefaultKey(request: Request): string | undefined | null {
  const params = new URL(request.url).searchParams;
  const value = params.get("pipelineDefaultKey");
  if (value === null) return undefined;
  if (!pipelineDefaultKeyPattern.test(value)) return null;
  return value;
}

const contactNameSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  company: true,
} as const;

export async function GET(request: Request) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineDefaultKey = parsePipelineDefaultKey(request);
  if (pipelineDefaultKey === null) return NextResponse.json({ error: "Invalid query" }, { status: 400 });

  const workspaceId = tenant.id;
  const dealsRepo = new PrismaDealsRepository(prisma as any);
  const pipelineRepo = new PrismaPipelineRepository(prisma as any);

  const pipeline = pipelineDefaultKey === undefined
    ? await pipelineRepo.findByWorkspace(workspaceId)
    : await pipelineRepo.findByDefaultKey(workspaceId, pipelineDefaultKey);
  const deals = pipeline === null ? [] : await dealsRepo.list(workspaceId, { pipelineId: pipeline.id });

  const contactIds: string[] = [...new Set(deals.flatMap((deal: DealRecord) => deal.contactId === undefined || deal.contactId === null ? [] : [deal.contactId]))];
  const contacts = contactIds.length === 0
    ? []
    : await prisma.contact.findMany({
      where: { tenantId: workspaceId, id: { in: contactIds } },
      select: contactNameSelect,
    });
  const contactById = new Map(contacts.map((contact) => [contact.id, contact] as const));
  const dealsWithContacts = deals.map((deal: DealRecord) => ({
    ...deal,
    contact: deal.contactId === undefined || deal.contactId === null ? null : contactById.get(deal.contactId) ?? null,
  }));

  return NextResponse.json({ pipeline, deals: dealsWithContacts });
}
