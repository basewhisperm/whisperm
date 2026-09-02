import { z } from "zod";

import type { PersistenceCorrelationMetadata, TenantScoped } from "@whisperm/types";
import type { DraftInventoryRepository, MarketplaceAcquisitionRepository } from "@whisperm/repositories";
import type {
  MarketplaceRequalificationCrmConversionStatus,
  MarketplaceRequalificationQualificationStatus,
} from "./marketplace-requalification.js";

export const editExtractInputSchema = z.object({
  title:       z.string().min(1).max(300).optional(),
  sellerName:  z.string().min(1).max(255).optional(),
  sellerPhone: z.string().min(1).max(64).optional(),
  sellerEmail: z.string().email().max(320).optional(),
  description: z.string().min(1).max(3000).optional(),
  priceText:   z.string().min(1).max(120).optional(),
  currency:    z.string().length(3).optional(),
  category:    z.string().min(1).max(255).optional(),
  location:    z.string().min(1).max(255).optional(),
}).strict().refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: "At least one field must be provided" },
);

export type EditExtractInput = z.infer<typeof editExtractInputSchema>;

export interface EditExtractContext extends TenantScoped {
  readonly actorId?: string | undefined;
  readonly correlation?: PersistenceCorrelationMetadata | undefined;
}

export interface EditExtractResult {
  readonly qualificationStatus: MarketplaceRequalificationQualificationStatus;
  readonly crmConversionStatus: MarketplaceRequalificationCrmConversionStatus;
  readonly requalified: boolean;
  readonly invitationEligible: boolean;
}

/** Narrow view of MarketplaceRequalificationService so this module does not depend on its full dependency graph. */
export interface RequalificationPort {
  requalifyMarketplaceCapture(
    context: { readonly tenantId: string; readonly actorId?: string | undefined; readonly correlation: PersistenceCorrelationMetadata },
    captureId: string,
  ): Promise<{
    readonly qualificationStatus: MarketplaceRequalificationQualificationStatus;
    readonly crmConversionStatus: MarketplaceRequalificationCrmConversionStatus;
    readonly requalified: boolean;
    readonly invitationEligible: boolean;
  }>;
}

export interface SellerAcquisitionEditDependencies {
  readonly marketplaceAcquisition: MarketplaceAcquisitionRepository;
  readonly draftInventories: DraftInventoryRepository;
  /** ST1-007: whenever a qualifying field (phone) changes, re-runs the canonical qualification + CRM conversion pipeline. */
  readonly requalification?: RequalificationPort | undefined;
}

const randomCorrelationId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class SellerAcquisitionEditService {
  constructor(private readonly deps: SellerAcquisitionEditDependencies) {}

  async editExtract(context: EditExtractContext, captureId: string, raw: unknown): Promise<EditExtractResult> {
    const input = editExtractInputSchema.parse(raw);

    const capture = await this.deps.marketplaceAcquisition.findMarketplaceCaptureById(context, captureId);
    if (capture === null) {
      throw Object.assign(new Error("Capture not found"), { status: 404 });
    }

    // --- Parse priceText into a numeric string + currency code ---------------
    // Strips known currency symbols/codes, removes comma separators, then
    // converts to a float. If parsing fails the price fields are simply not
    // updated -- a partial edit that only fixes sellerName is still valuable.
    let parsedPrice: string | undefined;
    let resolvedCurrency: string | undefined;

    if (input.priceText !== undefined) {
      const currencyFromText =
        /GH₵|GHS|₵/iu.test(input.priceText) ? "GHS" :
        /\$|USD/iu.test(input.priceText)      ? "USD" :
        undefined;

      const normalized = input.priceText
        .replace(/GH₵|GHS|USD|\$|₵/giu, "")
        .replace(/,/g, "")
        .trim();

      const numeric = parseFloat(normalized);
      if (Number.isFinite(numeric)) {
        parsedPrice = String(numeric);
        // Priority: explicit currency field > currency inferred from price symbol
        resolvedCurrency = input.currency ?? currencyFromText;
      }
    } else if (input.currency !== undefined) {
      // Currency-only update (no priceText), still valid
      resolvedCurrency = input.currency;
    }

    // --- DraftInventory: inventory-facing fields ------------------------------
    const draftUpdates: Record<string, unknown> = {};
    if (input.title !== undefined)       draftUpdates.title = input.title;
    if (input.description !== undefined) draftUpdates.description = input.description;
    if (parsedPrice !== undefined)       draftUpdates.price = parsedPrice;
    if (resolvedCurrency !== undefined)  draftUpdates.currency = resolvedCurrency;
    if (input.category !== undefined)    draftUpdates.category = input.category;

    if (Object.keys(draftUpdates).length > 0) {
      const draft = await this.deps.draftInventories.findByMarketplaceCaptureId(context, captureId);
      if (draft !== null) {
        await this.deps.draftInventories.update(context, draft.id, draftUpdates);
      } else {
        // No DraftInventory row yet (common for newly-captured sellers that
        // have not been invited yet). Create one so inventory fields have a
        // canonical home for the edits.
        await this.deps.draftInventories.upsertForCapture(context, {
          tenantId: context.tenantId,
          marketplaceCaptureId: captureId,
          title: (input.title ?? capture.title) as string,
          ...draftUpdates,
          status: "DRAFT",
        });
      }
    }

    // --- MarketplaceCapture: contact + context fields ------------------------
    // sellerName goes into capture.sellerName (used by contact-matching and
    // the sellerName() display function which checks capture.sellerName).
    // sellerPhone, sellerEmail, and location go into capture.metadata so they are picked up
    // by the metadataText() resolver in page.tsx without needing a schema
    // migration for dedicated columns.
    const existingMeta: Record<string, unknown> =
      typeof capture.metadata === "object" && capture.metadata !== null
        ? { ...(capture.metadata as Record<string, unknown>) }
        : {};

    const metaUpdates: Record<string, unknown> = { ...existingMeta };
    if (input.sellerPhone !== undefined) metaUpdates.sellerPhone = input.sellerPhone;
    if (input.sellerEmail !== undefined) metaUpdates.sellerEmail = input.sellerEmail;
    if (input.location !== undefined)    metaUpdates.location    = input.location;

    const captureUpdates: Record<string, unknown> = {};
    if (input.sellerName !== undefined)  captureUpdates.sellerName = input.sellerName;

    const metaChanged =
      Object.keys(metaUpdates).length !== Object.keys(existingMeta).length ||
      Object.entries(metaUpdates).some(([k, v]) => existingMeta[k] !== v);
    if (metaChanged) captureUpdates.metadata = metaUpdates;

    if (Object.keys(captureUpdates).length > 0) {
      await this.deps.marketplaceAcquisition.updateMarketplaceCapture(context, captureId, captureUpdates);
    }

    // --- Requalification: only qualifying-field edits (phone/WhatsApp) re-run the canonical
    // qualification + CRM conversion pipeline. Unrelated edits (title, price, description, ...)
    // must not trigger it.
    if (input.sellerPhone !== undefined && this.deps.requalification !== undefined) {
      return this.deps.requalification.requalifyMarketplaceCapture(
        {
          tenantId: context.tenantId,
          actorId: context.actorId,
          correlation: context.correlation ?? { correlationId: randomCorrelationId() },
        },
        captureId,
      );
    }

    const alreadyQualified = capture.contactId != null && capture.dealId != null;
    return {
      qualificationStatus: alreadyQualified ? "QUALIFIED" : "UNQUALIFIED",
      crmConversionStatus: alreadyQualified ? "EXISTING" : "NOT_ELIGIBLE",
      requalified: false,
      invitationEligible: alreadyQualified,
    };
  }
}
