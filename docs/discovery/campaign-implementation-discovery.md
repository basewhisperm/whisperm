CONSTITUTIONAL SLICE 001 — CAMPAIGN IMPLEMENTATION DISCOVERY RECONCILIATION

Objective:
Reconcile the existing Campaign implementation with the WhispeRM Constitution and architecture documents by producing a descriptive implementation discovery report.

This PR must document current reality. It must not introduce new production behavior unless explicitly authorized after discovery.

Architecture references:
- docs/architecture/00_AUTONOMOUS_ACQUISITION_PLATFORM.md
- docs/architecture/business-growth-opportunity-engine.md
- docs/architecture/canonical-domain-model.md
- docs/architecture/campaign-aggregate.md, if present
- docs/architecture/campaign-runtime.md, if present
- existing campaign implementation in apps, packages, and prisma

Constitutional principles:
- Campaign is the primary business object.
- Business Growth Opportunity is the primary economic object.
- Campaign owns strategy.
- Workers execute strategy.
- Growth Opportunity. Every Day.

Important:
This slice is descriptive, not normative.

The Constitution and Architecture are authoritative.
The implementation discovery report records what exists today.
Where implementation differs from architecture, document the gap.
Do not redefine architecture from implementation.

------------------------------------------------------------
PHASE 1 — PR TRIAGE
------------------------------------------------------------

Inspect the current PR #299.

Determine changed files.

If PR #299 only changes documentation:
- Continue.
- Ensure the document is placed at:

  docs/discovery/campaign-implementation-discovery.md

If the PR currently modifies production code:
- Stop.
- List every production file changed.
- Explain why each production change was included.
- Do not add more production code in this slice.

If the PR creates or modifies docs/CAMPAIGN_ARCHITECTURE.md:
- Do not treat that file as authoritative architecture.
- Move/convert the content into:

  docs/discovery/campaign-implementation-discovery.md

- The authoritative architecture remains under:

  docs/architecture/

------------------------------------------------------------
PHASE 2 — REQUIRED DOCUMENT HEADER
------------------------------------------------------------

The discovery report must begin with:

# Campaign Implementation Discovery

Status: Descriptive Implementation Discovery Report

This document records the current implementation state of Campaign-related seller acquisition and discovery flows.

It is descriptive, not normative.

Where implementation differs from the WhispeRM Constitution or architecture documents, the Constitution and architecture remain authoritative.

This document exists to help future Constitutional Slices reconcile implementation toward the architecture without duplicating existing Campaign, discovery, runtime, or UI concepts.

------------------------------------------------------------
PHASE 3 — IMPLEMENTATION SCAN
------------------------------------------------------------

Before editing the report, inspect:

- apps/web/src/app/(app)/marketplace-acquisition/campaigns
- apps/web/src/components/marketplace-acquisition
- apps/web/src/app/api/marketplace-acquisition/campaigns
- apps/web/src/app/api/marketplace-acquisition/campaigns/[campaignId]/discovery
- packages/services/src/seller-acquisition-campaigns.ts
- packages/services/src/marketplace-acquisition/discovery-service.ts
- packages/services/src/marketplace-acquisition/qualification-service.ts
- packages/repositories/src/marketplace-discovery.ts
- packages/repositories/src/marketplace-acquisition.ts
- packages/campaign-runtime/src/index.ts, if present
- prisma/schema.prisma

Run searches:

grep -R "Campaign\|campaignId\|MarketplaceAcquisitionCampaign\|SellerAcquisitionCampaign" -n \
  apps packages prisma \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.next

grep -R "discovery/runs\|MarketplaceDiscoveryRun\|DiscoveredMarketplaceSeller\|MANUAL_SEED\|sellersFound\|sellersQualified\|sellersRejected" -n \
  apps packages prisma \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.next

grep -R "campaign-runtime\|CampaignRuntime\|Execution\|Worker\|dispatcher\|schedule" -n \
  apps packages prisma \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.next

------------------------------------------------------------
PHASE 4 — REQUIRED REPORT STRUCTURE
------------------------------------------------------------

Update/create:

docs/discovery/campaign-implementation-discovery.md

Use this structure:

# Campaign Implementation Discovery

## 1. Purpose

Explain that this report records current implementation reality and exists to support future reconciliation.

## 2. Constitutional Alignment

Reference:
- Campaign is the primary business object.
- Business Growth Opportunity is the primary economic object.
- Campaign owns strategy.
- Workers execute strategy.
- Growth Opportunity. Every Day.

## 3. Current Implementation Inventory

Create these subsections:

### Campaign Model / Table
Document the actual Prisma model/table and fields.

### Campaign Service
Document existing service files and responsibilities.

### Campaign Repository
Document existing repository files and responsibilities.

### Campaign UI
Document existing pages/components:
- campaigns list
- campaign card
- open/edit/archive
- campaign workbench
- discovery tab if present

### Campaign API Routes
Document existing routes and methods.

### Discovery Runs
Document existing campaign-scoped discovery run behavior.

### Discovered Sellers
Document existing discovered seller behavior.

### Grid Page Bulk Discovery Intake
Document:
- looksLikeGridPage
- GridPageDiscoveryForm
- portfolioListings
- MANUAL_SEED
- POST /api/marketplace-acquisition/campaigns/:campaignId/discovery/runs
- sellersFound / sellersQualified / sellersRejected

### Existing campaign-runtime Package
If packages/campaign-runtime exists, document:
- purpose
- exported types/functions
- lifecycle concepts
- execution concepts
- reusable seams
- mismatch with WhispeRM constitutional Campaign model

If it does not exist, state that clearly.

## 4. Current Runtime Flow

Document current actual flow:

Campaign
→ grid/category page detected
→ portfolio listings extracted
→ GridPageDiscoveryForm
→ campaign discovery run
→ seeded seller qualification
→ campaign workbench review

Also document the single-listing capture path and whether campaign ownership is verified.

## 5. Current vs Constitutional Target

Create this table:

| Area | Current Implementation | Constitutional Target | Status | Reconciliation Need |
|---|---|---|---|---|

Include at minimum:

- Campaign
- Campaign lifecycle
- Discovery runs
- Grid intake
- Marketplace source selection
- Runtime execution
- Worker dispatcher
- Business Growth Opportunity
- Potential Opportunity
- Seller Intelligence
- Learning Event
- Revenue Event
- CRM conversion
- Billing/credits

Use status:
- Aligned
- Partial
- Missing
- Drift Risk

## 6. Do Not Rebuild Principle

Include:

Existing Campaign functionality must be reconciled and extended.

Do not introduce parallel Campaign models, duplicate Campaign APIs, duplicate runtime packages, duplicate discovery services, or replacement UI unless an explicit architecture decision requires it.

Prefer evolutionary reconciliation over replacement.

## 7. Safe Extension Points

List files that are safe to extend in future implementation slices.

## 8. Drift Risks

List:
- raw marketplaceSourceId input
- global/non-campaign acquisition flows
- discovery counters used as billing truth
- direct CRM creation before acquisition qualification
- duplicate runtime concepts
- campaign-runtime package mismatch if applicable

## 9. Constitutional Reconciliation Roadmap

Replace old “Recommended Future Slice Order” with:

1. Campaign Runtime Foundation
2. Runtime Worker Dispatcher
3. Marketplace Intelligence Worker
4. Seller Intelligence Worker
5. Business Growth Opportunity Pipeline
6. Autonomous Acquisition Worker
7. Learning Engine
8. Revenue Attribution
9. Daily Growth Opportunity Dashboard

## 10. Acceptance Summary

End with:
- What exists today.
- What is missing.
- What must not be rebuilt.
- What the next implementation slice should be.

------------------------------------------------------------
PHASE 5 — STRICT SCOPE
------------------------------------------------------------

Allowed:
- Create or update docs/discovery/campaign-implementation-discovery.md
- Move old docs/CAMPAIGN_ARCHITECTURE.md content into docs/discovery if needed
- Add links to architecture documents
- Clarify current vs target state

Not allowed:
- No Prisma changes
- No API behavior changes
- No React UI changes
- No service changes
- No repository changes
- No package exports
- No runtime implementation
- No discovery worker implementation
- No WhatsApp
- No CRM conversion
- No billing changes

If code changes already exist in PR #299:
- Isolate them.
- Report them.
- Do not expand them.

------------------------------------------------------------
PHASE 6 — ACCEPTANCE CRITERIA
------------------------------------------------------------

PR #299 is acceptable when:

- The report lives at docs/discovery/campaign-implementation-discovery.md
- It is clearly marked descriptive, not normative
- It references the Constitution and architecture documents
- It documents current Campaign implementation accurately
- It documents existing discovery/grid intake behavior
- It documents existing campaign-runtime package if present
- It includes Current vs Constitutional Target table
- It includes Do Not Rebuild principle
- It includes Constitutional Reconciliation Roadmap
- It does not introduce duplicate architecture source of truth
- It does not introduce production code changes unless separately justified

Verification:

git diff --stat

Expected:
- docs/discovery/campaign-implementation-discovery.md added or modified
- optionally old docs/CAMPAIGN_ARCHITECTURE.md removed/renamed
- no production files changed

Commit message:
docs: reconcile campaign implementation discovery with constitution
