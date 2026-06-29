# Campaign Architecture Discovery

This document captures the current campaign architecture discovery state before new campaign implementation work begins. It focuses on campaign-scoped seller acquisition, discovery, conversion, revenue, and ownership boundaries.

## Post-Slice 0 Delta: Grid Page Bulk Discovery Intake

Post-discovery changes introduced a grid/category page intake path that can branch from marketplace capture into campaign-scoped bulk discovery:

- `MarketplaceCapturePayload` now includes `looksLikeGridPage`.
- Grid/category pages now branch away from the single-listing `CaptureForm`.
- `GridPageDiscoveryForm` accepts portfolio listings from the payload.
- `GridPageDiscoveryForm` requires campaign selection unless `campaignId` is already provided.
- `GridPageDiscoveryForm` posts seeded discovery runs to:
  - `POST /api/marketplace-acquisition/campaigns/:campaignId/discovery/runs`
- The discovery request payload uses:
  - `mode: MANUAL_SEED`
- Seed entries are built from portfolio listing URLs, title, price, currency, category, and location.
- The response expects campaign discovery run counters:
  - `sellersFound`
  - `sellersQualified`
  - `sellersRejected`
- Current UX weakness:
  - `marketplaceSourceId` is still a raw UUID input.
- Future slice requirement:
  - Replace the raw `marketplaceSourceId` input with a campaign/source selector or campaign default source.

## Campaign Runtime Flow

Current campaign runtime flow now includes both direct campaign capture and grid/category discovery intake:

```text
Campaign
→ Grid/category page detected
→ Portfolio listings extracted
→ GridPageDiscoveryForm
→ Campaign discovery run
→ Seeded seller qualification
→ Campaign workbench review
```

The grid/category branch is campaign-scoped once a `campaignId` is selected or supplied in the intake URL. The single-listing capture path still routes through capture intake and should be verified for campaign ownership and tenant isolation before further monetization work.

## Current Entry Points

### Web Pages

#### `/marketplace-acquisition/capture/intake`

- **Purpose:** Handles both single listing capture and grid/category page bulk discovery intake.
- **Campaign-scoped?** Partially. Grid discovery is campaign-scoped through the selected `campaignId`.
- **Notes:** Single listing capture may still need verification for campaign ownership. Grid/category pages are detected from the capture payload and routed to `GridPageDiscoveryForm` rather than the single-listing `CaptureForm`.

### API Routes

#### `/api/marketplace-acquisition/campaigns/[campaignId]/discovery/runs`

- **Method:** `POST`
- **Purpose:** Creates campaign-scoped discovery runs from seeded listing entries.
- **Campaign-scoped?** Yes.
- **Notes:** Used by `GridPageDiscoveryForm` with `MANUAL_SEED` mode. The route receives `marketplaceSourceId`, `marketplaceSourceKey`, `mode`, and `entries`, then returns discovery run counters including `sellersFound`, `sellersQualified`, and `sellersRejected`.

## Campaign Child Objects

Campaign child objects include discovery runs/jobs, discovered sellers, captures, contacts, deals, draft inventory, invitations, conversion artifacts, billing events, and usage records.

### Discovery Job / Discovery Run

Discovery runs are campaign-scoped child objects that group marketplace seller discovery attempts under a campaign. They now include `MANUAL_SEED` intake from grid/category pages, where portfolio listing entries extracted from a marketplace page are submitted to a campaign discovery run for seeded seller qualification.

Important current attributes and semantics:

- Discovery run ownership must remain tenant- and campaign-scoped.
- `MANUAL_SEED` runs can be created from grid/category page intake and from campaign discovery UI flows.
- Runs record seller counters such as `sellersFound`, `sellersQualified`, and `sellersRejected` for campaign workbench review.
- Runtime enforcement must preserve tenant isolation around campaign, marketplace source, discovered seller, capture, and credit usage records.

## Revenue Architecture

Campaign revenue architecture depends on turning campaign activity into billable, auditable value units such as discovery, qualification, invitation, conversion, and managed acquisition outcomes.

Grid/category page discovery is now a high-leverage seller acquisition entry point because one marketplace page can feed many candidate sellers into a paid campaign discovery workflow.

Revenue-sensitive design constraints:

- Billable units must be tenant-scoped and campaign-scoped.
- Discovery and conversion actions should remain idempotent so retries do not double-charge tenants.
- Usage attribution should be tied to persisted campaign child objects rather than transient browser payloads.
- Counters returned to the UI should not be treated as billing truth unless backed by persisted usage records.

## Billing / Credits / Usage

Open question:

- Confirm whether `MANUAL_SEED` discovery consumes discovery credits per listing submitted, per seller qualified, or per unique seller persisted.

Recommended answer for a future slice:

- Consume credits only after a unique seller/capture is persisted successfully.

This recommended approach aligns credit consumption with durable tenant value, avoids charging for rejected or duplicate entries, and supports idempotent retry behavior.

## Folder Drift / Ownership Drift

Risk:

- `GridPageDiscoveryForm` currently lives inside the capture intake page. This is acceptable short-term but may later need extraction into a campaign discovery component.

Ownership considerations:

- Capture intake owns browser capture payload validation and branching.
- Campaign discovery should own campaign-scoped bulk discovery workflows.
- Future extraction should avoid changing API behavior unless paired with explicit migration and rollout notes.

## Safe Extension Points

The following files are safe extension points for future slices when changes are explicitly scoped to campaign discovery intake or capture payload handling:

- `apps/web/src/lib/marketplace-capture/payload.ts`
- `apps/web/src/app/(app)/marketplace-acquisition/capture/intake/page.tsx`
- `apps/web/src/app/api/marketplace-acquisition/campaigns/[campaignId]/discovery/runs`

Any future implementation must preserve tenant isolation, validate untrusted input, and keep campaign/source ownership checks explicit.

## Recommended Future Slice Order

1. Campaign Monetization Foundation
2. Campaign Discovery Engine
3. Campaign Conversion Engine
4. Campaign Revenue Command Center
