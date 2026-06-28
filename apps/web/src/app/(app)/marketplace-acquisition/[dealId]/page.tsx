import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { IconClock, IconNote } from "@tabler/icons-react";
import { SellerAcquisitionInvitePanel } from "@/components/seller-acquisition/invite-panel";
import { PrismaDealsRepository, PrismaMarketplaceCaptureRepository, PrismaPipelineRepository, type ActivityRecord, type PrismaPersistenceClient } from "@whisperm/repositories";
import { MARKETPLACE_ACQUISITION_PIPELINE_KEY } from "@whisperm/types";

import { getTenantForCurrentUser } from "@/lib/get-tenant";
import { prisma } from "@/lib/prisma";

const marketplacePipelineKey = MARKETPLACE_ACQUISITION_PIPELINE_KEY;

type PageProps = {
  params: { dealId: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()))];
}

function extractNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") { const n = Number(value); return Number.isFinite(n) ? n : null; }
  // Prisma Decimal serialized as JSON object: { d: number[], e: number, s: number }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.d === "object" && Array.isArray(obj.d) && typeof obj.e === "number") {
      const str = (obj.s === -1 ? "-" : "") + obj.d.join("").slice(0, obj.e + 1) + "." + (obj.d.join("").slice(obj.e + 1) || "0");
      const n = Number(str);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof (value as { toString(): string }).toString === "function") {
      const str = (value as { toString(): string }).toString();
      if (str !== "[object Object]") { const n = Number(str); return Number.isFinite(n) ? n : null; }
    }
  }
  return null;
}

function formatValue(value?: unknown, currency?: string | null) {
  if (value === undefined || value === null) return "Not provided";
  const numeric = extractNumeric(value);
  if (numeric === null) return "Not provided";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "GHS", maximumFractionDigits: 0 }).format(numeric);
}

function formatDate(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function contactName(contact: unknown) {
  if (contact === null || contact === undefined || typeof contact !== "object") return "Not linked";
  const data = contact as { firstName?: string | null; lastName?: string | null; email?: string | null; company?: string | null };
  return [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email || data.company || "Not linked";
}

function contactPhone(contact: unknown, metadata: Record<string, unknown>) {
  if (contact !== null && contact !== undefined && typeof contact === "object") {
    const phone = stringValue((contact as { phone?: unknown }).phone);
    if (phone) return phone;
  }
  return stringValue(metadata.sellerPhone) ?? stringValue(metadata.phone) ?? stringValue(metadata.primaryPhoneNumber) ?? "Not provided";
}

function contactEmail(contact: unknown, metadata: Record<string, unknown>) {
  if (contact !== null && contact !== undefined && typeof contact === "object") {
    const email = stringValue((contact as { email?: unknown }).email);
    if (email) return email;
  }
  return stringValue(metadata.sellerEmail) ?? stringValue(metadata.email) ?? "Not provided";
}

function ownerName(owner: { displayName?: string | null | undefined; email?: string | null | undefined } | null | undefined) {
  return owner?.displayName || owner?.email || "Unassigned";
}


async function archiveAcquisition(formData: FormData) {
  "use server";

  const dealId = stringValue(formData.get("dealId"));
  const tenant = await getTenantForCurrentUser();

  if (tenant === null || tenant === undefined || dealId === undefined) return;

  const client = prisma as unknown as PrismaPersistenceClient;
  const dealsRepo = new PrismaDealsRepository(client);
  const pipelineRepo = new PrismaPipelineRepository(client);
  const captureRepo = new PrismaMarketplaceCaptureRepository(client);

  const [pipeline, deal] = await Promise.all([
    pipelineRepo.findByDefaultKey(tenant.id, marketplacePipelineKey),
    dealsRepo.findById(tenant.id, dealId),
  ]);

  if (pipeline === null || deal === null || deal.pipelineId !== pipeline.id) return;

  const expiredStage = pipeline.stages.find((stage) => stage.name === "Expired");
  if (expiredStage === undefined) return;

  const capture = await captureRepo.findByDealId({ tenantId: tenant.id }, deal.id);
  if (capture === null) return;

  await dealsRepo.updateStage(tenant.id, deal.id, expiredStage.id);
  await captureRepo.update({ tenantId: tenant.id }, capture.id, { status: "EXPIRED" });

  revalidatePath(`/marketplace-acquisition/${deal.id}`);
  revalidatePath("/marketplace-acquisition");
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-background p-4" style={{ border: "0.5px solid var(--color-border)" }}>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="mt-2 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

const activityTimestamp = (activity: ActivityRecord): string | Date | null | undefined => activity.occurredAt ?? activity.createdAt;

function ActivityTimeline({ activities }: { readonly activities: readonly ActivityRecord[] }) {
  return (
    <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
      <h2 className="text-sm font-semibold text-foreground">Activity Timeline</h2>
      {activities.length === 0 ? (
        <p className="mt-6 rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">No activity yet for this acquisition opportunity.</p>
      ) : (
        <ol className="mt-5 space-y-4">
          {activities.map((activity) => (
            <li key={activity.id} className="flex gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-mist text-whisper">
                <IconNote className="size-4" stroke={1.8} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 rounded-xl bg-secondary p-3">
                <p className="text-sm font-semibold text-foreground">{activity.type}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{activity.note || "No note provided."}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconClock className="size-3.5" stroke={1.8} aria-hidden="true" />
                  {formatDate(activityTimestamp(activity))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function MarketplaceAcquisitionDealDetailPage({ params }: PageProps) {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) notFound();

  const deals = new PrismaDealsRepository(prisma as unknown as PrismaPersistenceClient);

  const [pipeline, detail] = await Promise.all([
    prisma.pipeline.findFirst({ where: { tenantId: tenant.id, defaultKey: marketplacePipelineKey }, include: { stages: { orderBy: { position: "asc" } } } }),
    deals.findDetailById(tenant.id, params.dealId),
  ]);

  if (detail === null) notFound();
  const deal = detail.deal;

  if (pipeline === null || deal.pipelineId !== pipeline.id) {
    return (
      <div className="rounded-2xl bg-background p-6" style={{ border: "0.5px solid var(--color-border)" }}>
        <p className="text-sm font-medium text-foreground">This deal is not a Seller Acquisition opportunity.</p>
        <Link className="mt-4 inline-flex text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition">Back to Seller Acquisition</Link>
      </div>
    );
  }

  const stage = pipeline.stages.find((pipelineStage) => pipelineStage.id === deal.pipelineStageId);

  const capture = await prisma.marketplaceCapture.findFirst({
    where: { tenantId: tenant.id, dealId: deal.id },
    include: {
      marketplaceSource: { select: { key: true, name: true } },
      sellerInvitations: { orderBy: { createdAt: "desc" } },
      draftInventories: { orderBy: { updatedAt: "desc" } },
    },
    orderBy: { capturedAt: "desc" },
  });

  const captureSafeFields = asRecord(capture?.["metadata"]);
  const draft = capture?.draftInventories[0] ?? null;
  const draftImages = draft === null ? [] : stringArray(draft.images);
  const captureImages = stringArray(captureSafeFields.imageUrls).concat(stringArray(captureSafeFields.images));
  const images = [...new Set([...draftImages, ...captureImages])];

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm font-medium text-whisper hover:underline" href="/marketplace-acquisition">← Back to Seller Acquisition</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Acquisition Deal</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{deal.title ?? "Untitled acquisition opportunity"}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">{stage?.name ?? "Unknown stage"}</span>
            {stage?.name !== "Expired" && stage?.name !== "Converted" && (
              <form action={archiveAcquisition}>
                <input name="dealId" type="hidden" value={deal.id} />
                <button className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-muted-foreground hover:text-foreground" type="submit">
                  Archive
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Deal summary">
        <DetailRow label="Stage">{stage?.name ?? "Unknown stage"}</DetailRow>
        <DetailRow label="Contact">{contactName(detail.contact)}</DetailRow>
        <DetailRow label="Phone">{contactPhone(detail.contact, captureSafeFields)}</DetailRow>
        <DetailRow label="Email">{contactEmail(detail.contact, captureSafeFields)}</DetailRow>
        <DetailRow label="Owner">{ownerName(detail.owner)}</DetailRow>
        <DetailRow label="price / deal value">{formatValue(deal.value, deal.currency)}</DetailRow>
      </section>

      {capture !== null && (
        <section className="space-y-3" aria-label="Marketplace capture context">
          <h2 className="text-lg font-semibold text-foreground">Marketplace capture context</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DetailRow label="Listing URL"><a className="break-all text-whisper hover:underline" href={capture.listingUrl} target="_blank" rel="noreferrer">{capture.listingUrl}</a></DetailRow>
            <DetailRow label="Marketplace/source">{capture.marketplaceSource?.name ?? capture.marketplaceSource?.key ?? stringValue(captureSafeFields.marketplaceSource) ?? "Not provided"}</DetailRow>
            <DetailRow label="Seller name">{capture.sellerName ?? "Not provided"}</DetailRow>
            <DetailRow label="Capture status">{capture.status}</DetailRow>
            <DetailRow label="Draft inventory">{draft?.status ?? "No draft inventory"}</DetailRow>
            <DetailRow label="Captured">{formatDate(capture.capturedAt)}</DetailRow>
          </div>
        </section>
      )}

      {images.length > 0 && (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <h2 className="text-sm font-semibold text-foreground">Captured images</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {images.map((imageUrl) => (
              <a key={imageUrl} href={imageUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Captured marketplace listing" className="h-36 w-full object-cover" />
              </a>
            ))}
          </div>
        </section>
      )}

      {capture !== null && (
        <section className="rounded-2xl bg-background p-5" style={{ border: "0.5px solid var(--color-border)" }}>
          <h2 className="text-sm font-semibold text-foreground">Invitation transactions</h2>
          {capture.sellerInvitations.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No invitation has been created for this capture yet.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {capture.sellerInvitations.map((invitation) => (
                <div key={invitation.id} className="rounded-xl bg-secondary p-3 text-sm">
                  <p className="font-semibold text-foreground">{invitation.channel} · {invitation.status}</p>
                  <p className="mt-1 break-all text-muted-foreground">{invitation.recipient}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Created {formatDate(invitation.createdAt)} · Expires {formatDate(invitation.expiresAt)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {capture !== null && <SellerAcquisitionInvitePanel captureId={capture.id} />}

      <ActivityTimeline activities={detail.activity} />
    </div>
  );
}
