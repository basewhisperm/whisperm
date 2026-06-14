# DSM WhispeRM Seller Acquisition Slice 2.8 — Draft Inventory Foundation

## Purpose

Draft Inventory is the canonical pre-claim inventory record for seller acquisition. It gives every successfully captured marketplace listing a tenant-scoped inventory placeholder before claim, invitation, attestation, or Render conversion workflows are introduced.

## Implemented behavior

- Adds `DraftInventoryStatus` with `DRAFT`, `CLAIM_PENDING`, `CLAIMED`, `CONVERTED`, and `EXPIRED`.
- Adds `DraftInventory` as a tenant-scoped record linked to `MarketplaceCapture`, and linked to `Contact` and `Deal` when those records exist in the capture flow.
- Ensures marketplace acquisition capture creates or reuses exactly one draft inventory record in the same transaction as capture/contact/deal work.
- Reuses existing draft inventory for the same tenant and capture.
- Reuses or updates existing draft inventory for the same tenant, marketplace source, and marketplace listing identifier when those values are present.
- Extends marketplace acquisition capture responses with `draftInventoryId`.
- Copies listing snapshot fields from the capture input/capture record into draft inventory without re-scraping external marketplaces.

## Files changed

- `prisma/schema.prisma`
- `prisma/migrations/20260614000000_draft_inventory_foundation/migration.sql`
- `packages/repositories/src/index.ts`
- `packages/services/src/index.ts`
- `packages/services/test/marketplace-capture-deal-creation.test.mjs`
- `packages/types/src/marketplace-acquisition.ts`
- `apps/api/src/marketplace-acquisition.ts`
- `docs/product/DSM_WhispeRM_Seller_Acquisition_Slice_2_8_Draft_Inventory.md`

## Data model summary

`DraftInventory` contains:

- Tenant scope: `tenantId`
- Capture linkage: `marketplaceCaptureId`
- Seller/deal linkage when available: `contactId`, `dealId`
- Listing snapshot: `title`, `description`, `price`, `currency`, `category`, `images`, `listingUrl`, `marketplaceSource`, `marketplaceListingId`
- Lifecycle placeholder: `status` defaulting to `DRAFT`
- Timestamps: `createdAt`, `updatedAt`

Indexes are tenant-scoped for capture, contact, deal, status, and marketplace listing lookup. The schema intentionally avoids unsafe uniqueness on nullable marketplace listing fields; duplicate protection for those fields is handled in repository/service logic within tenant scope.

## Acceptance criteria

- A successful marketplace acquisition capture returns `draftInventoryId`.
- A successful marketplace acquisition capture creates a `DraftInventory` with the same `tenantId` as the capture.
- The draft inventory links to the `MarketplaceCapture`.
- The draft inventory links to the contact/seller abstraction when a contact exists.
- The draft inventory links to the acquisition deal when a deal exists.
- Draft inventory copies listing snapshot fields from capture input/capture data.
- Duplicate capture reuses existing draft inventory and does not create uncontrolled duplicates.
- No TrustLayer requirement is introduced.

## Out of scope

- Claim portal
- Seller invitation workflow
- 7-day claim automation
- Ownership attestation
- Render seller conversion
- Render inventory conversion
- Retry framework
- Analytics
- Bookmarklet completion
- Terminology refactor

## Follow-up issues

- #141 lifecycle pipeline
- #142 seller invitation engine
- #143 7-day claim automation
- #144 claim portal
- #146 Render seller conversion
- #147 Render inventory conversion
