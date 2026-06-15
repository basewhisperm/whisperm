# DSM WhispeRM Seller Acquisition Slice 6.1 — Acquisition Analytics

## Purpose

Slice 6.1 adds read-only, tenant-isolated measurement for Seller Acquisition Engine performance. It reports acquisition, inventory, operations, and Render conversion health without changing capture, invitation, claim, or conversion behavior.

## Metric definitions

- **Captures**: `MarketplaceCapture` records created in the selected date range.
- **Captures per day**: captures grouped by `createdAt` UTC calendar day.
- **Invitations sent**: seller invitations with `SENT` or `OPENED` status.
- **Claim rate**: claimed or converted captures divided by invitations sent. Returns `0` when invitations sent is `0`.
- **Conversion rate**: converted captures divided by claimed or converted captures. Returns `0` when claimed count is `0`.
- **Expired count**: captures, seller invitations, and claim tokens with `EXPIRED` status.
- **Listings captured**: draft inventory records linked to the scoped captures.
- **Listings claimed**: draft inventory with `CLAIMED` or `CONVERTED` status.
- **Listings converted**: draft inventory with `CONVERTED` status.
- **Listings expired**: draft inventory with `EXPIRED` status.
- **Average time to invite**: seller invitation `createdAt` minus capture `createdAt`.
- **Average time to claim**: ownership attestation `attestedAt` minus invitation `createdAt`, falling back to capture `createdAt` when no invitation is present.
- **Average time to conversion**: successful Render conversion `completedAt` or `convertedAt` minus capture `createdAt`.
- **Conversion failures**: Render conversions with `FAILED` status.
- **Dead-lettered conversions**: Render conversions with `DEAD_LETTERED` status.

## API endpoint

`GET /marketplace-acquisition/analytics`

### Filters

- `dateFrom` (optional ISO datetime)
- `dateTo` (optional ISO datetime)
- `marketplaceSource` (optional marketplace source identifier)
- `channel` (optional invitation channel: `WHATSAPP`, `SMS`, or `EMAIL`)

## Tenant isolation

Every analytics query requires `tenantId` and scopes parent and child acquisition records to the authenticated tenant. Child records are limited to captures selected for that tenant and filter set, preventing cross-tenant exposure.

## Out of scope

- New capture flow
- New invitation workflow
- New claim portal behavior
- New Render conversion behavior
- TrustLayer verification
- Payment/escrow
- Marketplace re-scraping
- Revenue analytics

## Revenue metrics future work

Revenue metrics are intentionally omitted because Seller Acquisition revenue attribution is not currently represented in the acquisition/conversion persistence models used by this slice.
