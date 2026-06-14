import Link from "next/link";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";

const marketplacePipelineKey = "marketplace_acquisition";
const marketplaceAcquisitionDealsApiPath = "/api/deals?pipelineDefaultKey=marketplace_acquisition";

const acquisitionStageLabels = ["Captured", "Invited", "Converted"] as const;

function formatValue(value?: { toString(): string } | number | string | null, currency?: string | null) {
  const stringValue = typeof value === "object" && value !== null ? value.toString() : value;
  const numericValue = typeof stringValue === "string" ? Number(stringValue) : stringValue;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numericValue) ? numericValue ?? 0 : 0);
}

export default async function MarketplaceAcquisitionPage() {
  const tenant = await getTenantForCurrentUser();

  if (!tenant) {
    return <p className="text-sm text-muted-foreground">Unauthorized</p>;
  }

  const pipeline = await prisma.pipeline.findFirst({
    where: { tenantId: tenant.id, defaultKey: marketplacePipelineKey },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  if (pipeline === null) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-medium text-foreground">Marketplace Acquisition pipeline not found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Run the marketplace pipeline seed before reviewing acquisition opportunities.
        </p>
      </div>
    );
  }

  const deals = await prisma.deal.findMany({
    where: { tenantId: tenant.id, pipelineId: pipeline.id },
    orderBy: { updatedAt: "desc" },
  });

  const stageById = new Map(pipeline.stages.map((stage) => [stage.id, stage.name] as const));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Marketplace Acquisition
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Acquisition opportunities</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture, invite, and convert marketplace sellers into Render sellers.
        </p>
      </div>

      <Link href="/marketplace-acquisition/capture" className="text-sm font-medium text-foreground">
        Capture setup
      </Link>

      <div className="flex flex-wrap gap-2">
        {acquisitionStageLabels.map((stage) => (
          <span key={stage} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {stage}
          </span>
        ))}
      </div>

      {deals.length === 0 ? (
        <div
          className="rounded-2xl bg-background p-6 text-sm text-muted-foreground"
          style={{ border: "0.5px solid var(--color-border)" }}
        >
          No marketplace acquisition deals yet.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {deals.map((deal) => (
            <Link
              key={deal.id}
              href={`/marketplace-acquisition/${deal.id}`}
              className="rounded-2xl bg-background p-4 transition hover:shadow-md"
              style={{ border: "0.5px solid var(--color-border)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-foreground">{deal.title}</p>
                <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {stageById.get(deal.pipelineStageId) ?? "Unknown stage"}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">
                {formatValue(deal.value, deal.currency)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Updated {deal.updatedAt.toLocaleString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
