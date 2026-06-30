# Campaign Implementation Discovery Report

This document records current implementation state.
It is descriptive, not normative.
Where implementation differs from the Constitution or Architecture, the Constitution and Architecture remain authoritative.

## Constitutional references

Authoritative architecture remains in:

- `docs/architecture/00_AUTONOMOUS_ACQUISITION_PLATFORM.md`
- `docs/architecture/business-growth-opportunity-engine.md`
- `docs/architecture/canonical-domain-model.md`

Constitutional alignment used for this discovery:

- Campaign is the primary business object.
- Business Growth Opportunity is the primary economic object.
- Campaign owns strategy; workers execute strategy.
- The existing `@whisperm/campaign-runtime` package is the reusable campaign runtime seam. Do not create another campaign runtime package.

## Phase 1: PR #298 triage

Requested PR title: `docs: sync campaign architecture after grid discovery intake`.

Triage result in this workspace:

- The GitHub CLI is not installed in the container (`gh: command not found`).
- The local checkout does not expose a configured remote through `git remote -v`.
- `docs/CAMPAIGN_ARCHITECTURE.md` is not present in this checkout.
- No PR #298 branch or diff is available locally to inspect or close from this environment.

Operational conclusion:

- No production-code changes from PR #298 are visible in this checkout.
- No duplicate normative campaign architecture document is present in this checkout.
- This file is the descriptive implementation discovery report that should supersede any standalone `docs/CAMPAIGN_ARCHITECTURE.md` content if PR #298 only introduced that document.
- If PR #298 contains production code outside this checkout, those changes still require separate build/test triage before merge.

## Phase 2: existing implementation discovery

### 1. Existing Campaign model/table

There are two campaign-related persistence concepts in the repository:

1. `SellerAcquisitionCampaign` is the existing marketplace acquisition campaign table. It is tenant-scoped and stores name, description, status, owner, goal fields, date bounds, metadata, members, discovery runs, and discovered sellers.
2. The older/generic CRM/content `Campaign` repository interface and Prisma repository also exists in `packages/repositories/src/index.ts`, but it is not the marketplace acquisition campaign implementation inspected for this slice.

Current marketplace acquisition status enum values in Prisma are `DRAFT`, `ACTIVE`, `PAUSED`, and `ARCHIVED`. This is narrower than the runtime lifecycle states in `@whisperm/campaign-runtime`.

Tenant isolation observations:

- `SellerAcquisitionCampaign` has tenant-scoped unique/index definitions.
- Members, discovery runs, and discovered sellers relate back through `(tenantId, id)` compound relations.
- This is compatible with the constitutional rule that every acquisition workflow belongs to a Campaign, but the schema does not yet model Business Growth Opportunity as a first-class economic object.

### 2. Existing Campaign service

`SellerAcquisitionCampaignService` is a thin application service around `SellerAcquisitionCampaignRepository`.

Capabilities discovered:

- List campaigns.
- Create campaigns with `tenantId` copied from context.
- Find by campaign ID within tenant context.
- Update campaigns.
- Archive campaigns by setting `status: "ARCHIVED"`.
- Add/remove sellers.
- List campaign members.

Gap:

- The service does not yet translate a seller acquisition campaign into a `CampaignExecutionContract` from `@whisperm/campaign-runtime`.
- The service does not yet expose an execution command such as `executeCampaign`, `dispatchCampaign`, or `startRuntimeExecution`.

### 3. Existing Campaign repository

The existing marketplace acquisition campaign repository is `PrismaSellerAcquisitionCampaignRepository` in `packages/repositories/src/index.ts`.

Capabilities discovered:

- Tenant-scoped create/list/find/update for seller acquisition campaigns.
- Tenant-scoped campaign member add/remove/list operations.
- Pagination through shared page request helpers.
- Tenant assertions on create/member input paths.

Gap:

- No persistence contract for campaign runtime execution records is present in the marketplace acquisition campaign repository.
- There is no repository adapter that claims runtime idempotency for a campaign execution before dispatch.
- Runtime idempotency may need to use an existing generic idempotency/event repository rather than adding a new campaign table.

### 4. Existing Campaign UI routes

Existing marketplace acquisition campaign UI routes:

- `apps/web/src/app/(app)/marketplace-acquisition/campaigns/page.tsx` lists, filters, creates, edits, archives, and links campaigns to the workbench.
- `apps/web/src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/layout.tsx` provides campaign tabs for Workbench and Discovery.
- `apps/web/src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/workbench/page.tsx` renders the existing acquisition workbench in campaign-scoped mode.
- `apps/web/src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/discovery/page.tsx` provides campaign-scoped discovery run and seller review UI.

Gap:

- No new UI should be created for this slice.
- There is no runtime execution button/view in the UI, and this slice should not add duplicate campaign UI.

### 5. Existing Campaign API routes

Existing marketplace acquisition campaign API routes:

- `GET/POST /api/marketplace-acquisition/campaigns`
- `GET/PATCH/DELETE /api/marketplace-acquisition/campaigns/[campaignId]`
- `GET/POST /api/marketplace-acquisition/campaigns/[campaignId]/members`
- `DELETE /api/marketplace-acquisition/campaigns/[campaignId]/members/[memberId]`
- `GET/POST /api/marketplace-acquisition/campaigns/[campaignId]/discovery/runs`
- `GET /api/marketplace-acquisition/campaigns/[campaignId]/discovery/sellers`
- `POST /api/marketplace-acquisition/campaigns/[campaignId]/discovery/sellers/[sellerId]/promote`
- `POST /api/marketplace-acquisition/campaigns/[campaignId]/discovery/sellers/[sellerId]/reject`

Gap:

- There is no `POST /api/marketplace-acquisition/campaigns/[campaignId]/runtime/executions` endpoint in this checkout.
- Add that endpoint only when a runtime adapter exists and a caller is ready to dispatch safely through `@whisperm/campaign-runtime`.

### 6. Existing discovery run model

Existing discovery persistence:

- `MarketplaceDiscoveryRun` stores tenant, campaign, marketplace source, status, mode, counts, timestamps, error, config, metadata.
- `DiscoveredMarketplaceSeller` stores tenant, discovery run, campaign, marketplace source, identity key, status, qualification score/policy, seller/listing details, duplicate/promoted references, reviewer metadata, raw data, and timestamps.

Existing discovery service:

- `MarketplaceDiscoveryService` creates discovery runs, records discovered sellers from manual seed input, applies qualification, records duplicates, completes/fails runs, and summarizes counts.
- Discovery service depends on `MarketplaceDiscoveryRepository` and `SellerQualificationService`.

Existing qualification service:

- `SellerQualificationService` evaluates seller/listing fields against a policy and returns a deterministic status, score, reasons, and matched policy.

Gap:

- Discovery output is a discovered/promoted seller/capture, not yet a canonical Business Growth Opportunity.
- There is no explicit Potential Opportunity or Business Growth Opportunity table/model.
- Promotion currently feeds captures/campaign members rather than an opportunity lifecycle.

### 7. Existing campaign-runtime package capabilities

`packages/campaign-runtime/src/index.ts` is the existing runtime package and must be reused/adapted.

Reusable capabilities:

- Lifecycle contracts: `CampaignLifecycleSnapshot`, lifecycle state enum, transition guard, terminal-state helper.
- Execution contracts: `CampaignExecutionContract`, `createCampaignExecutionContract`, replay-safe execution contract, targeting, journey, sequence, channel, content, asset, quota, budget, approval, billing, schedule, telemetry, observability, audit, attribution, analytics, enrollment, pause/resume/archive/cancel contracts.
- Dispatch seam: `dispatchCampaignExecution(execution, ports)` with injectable ports for idempotency, scheduler, approval, billing, telemetry, observability, and enqueue.
- Idempotency: `buildCampaignIdempotencyKey`, replay-safe contract, idempotency `claim`/`complete` port.
- Retry policy: `CampaignRetryPolicy` and `calculateCampaignRetryDelayMs`.
- Tenant isolation: tenant context schema and `assertCampaignTenantIsolation` before dispatch.
- Scheduling contracts: `CampaignScheduleIntegrationContract` and scheduler port.
- Telemetry/audit contracts: telemetry and observability/audit integration contracts emitted during dispatch.

Mapping to constitutional WhispeRM model:

- Existing Seller Acquisition Campaign = current implementation of the constitutional Campaign for marketplace acquisition.
- Campaign strategy currently lives mostly in fields like status/goals/date bounds/metadata and in discovery configuration, not in a normalized strategy model.
- Existing discovery runs/discovered sellers are worker outputs toward Potential Opportunities.
- Existing captures/campaign members are the current operational bridge toward acquisition workflows.
- Business Growth Opportunity is not yet explicitly implemented; promoted/qualified sellers are the closest current approximation.
- The runtime package is generic outbound-campaign infrastructure, but its lifecycle, execution, dispatch, idempotency, retry, tenant, scheduling, telemetry, and audit seams are directly reusable for WhispeRM campaign execution.

### 8. Gaps against Canonical Domain Model

Primary gaps:

1. Campaign strategy is not fully explicit. Current seller acquisition campaigns have metadata and goal fields, but no strongly typed marketplace strategy, qualification policy, acquisition policy, automation policy, scheduling, or success metric contract at the service/API boundary.
2. Campaign lifecycle mismatch. Current persistence status is `DRAFT | ACTIVE | PAUSED | ARCHIVED`; runtime lifecycle includes validation, approval, scheduled/running/completed/failed/cancelled states.
3. Business Growth Opportunity is not first-class. Current implementation has discovered sellers, captures, members, deals, invitations, claims, and conversions, but no canonical Business Growth Opportunity object/lifecycle.
4. Runtime execution is not wired. `@whisperm/campaign-runtime` exists, but seller acquisition campaigns do not yet adapt into `CampaignExecutionContract` or dispatch via runtime ports.
5. Discovery is campaign-scoped and tenant-safe, but discovery run output is descriptive implementation data rather than canonical Potential Opportunity/Business Growth Opportunity data.
6. No runtime API endpoint exists for campaign executions.
7. No executor-level active delegation/concurrency enforcement for campaign runtime execution is visible in marketplace acquisition code; schema-time/runtime-contract validation must not be treated as sufficient executor coordination.
8. Audit/telemetry contracts exist in runtime, but marketplace acquisition campaign execution does not yet emit through them because execution is not wired.

Non-gaps / constraints to preserve:

- Do not create a second Campaign model.
- Do not create another campaign runtime package.
- Do not create a second discovery service.
- Do not create duplicate campaign UI.
- Do not add v1 tenant-level WhatsApp credential storage; per-tenant WABA remains a v2 design target.

### 9. Smallest safe reconciliation plan

Recommended smallest non-breaking sequence:

1. Keep this file as the descriptive implementation discovery report and avoid treating any `docs/CAMPAIGN_ARCHITECTURE.md` as normative architecture.
2. Add a narrow adapter in `packages/services` that maps an existing `SellerAcquisitionCampaignRecord` plus tenant/correlation context into `CampaignExecutionContract` from `@whisperm/campaign-runtime`.
3. Map current campaign statuses conservatively:
   - `DRAFT` -> runtime `DRAFT`
   - `ACTIVE` -> runtime `RUNNING` only at dispatch time
   - `PAUSED` -> runtime `PAUSED`
   - `ARCHIVED` -> runtime `ARCHIVED`
4. Keep strategy sourcing minimal and explicit: read only already-existing typed fields and metadata keys; do not invent new business strategy semantics.
5. Use runtime ports instead of direct side effects:
   - idempotency port backed by existing generic idempotency/event persistence if available
   - enqueue port for workers when a worker executor is ready
   - telemetry/audit ports for structured records
6. Add unit tests for tenant isolation and idempotent dispatch using mocked ports before exposing an API route.
7. Add `POST /api/marketplace-acquisition/campaigns/[campaignId]/runtime/executions` only after the adapter and tests exist. The endpoint must resolve tenant/auth using the existing route helpers, load the tenant-scoped campaign, validate input with Zod, create a runtime execution contract, and dispatch through runtime ports.
8. Do not introduce Business Growth Opportunity persistence in this slice. Document that as a follow-up canonical-domain migration requiring explicit data model design and rollout plan.

## Phase 3: key audit rule

The existing `@whisperm/campaign-runtime` package is reusable and should be adapted. A duplicate campaign runtime package would violate this slice.

Runtime adapter target shape:

- Input: tenant context, campaign ID, correlation metadata, execution ID/idempotency key, and optional dispatch mode.
- Load: existing `SellerAcquisitionCampaign` by tenant and ID.
- Validate: fail closed if tenant mismatch, campaign missing, archived, or paused when execution requires active state.
- Convert: construct `CampaignLifecycleSnapshot`, `CampaignTargetingContract`, optional schedule/quota/budget metadata, and `CampaignExecutionContract`.
- Dispatch: call `dispatchCampaignExecution` with tenant-safe ports.
- Persist/observe: use idempotency, telemetry, audit, and queue ports rather than direct worker side effects.

## Phase 4: minimal implementation scope applied in this slice

This slice intentionally implements documentation reconciliation only.

Rationale:

- PR #298 contents are not accessible in this environment.
- No `docs/CAMPAIGN_ARCHITECTURE.md` exists locally to rename.
- Existing production campaign/discovery/runtime code already exists but is not wired for execution.
- Adding a runtime adapter and API endpoint would be production behavior change and requires tests plus design of idempotency/queue ports; that is the next safe implementation slice.

## Phase 5: acceptance notes

- No duplicate architecture source of truth is introduced by this file.
- This report is descriptive and defers normative meaning to the constitutional architecture docs.
- Existing `@whisperm/campaign-runtime` package has been audited as reusable.
- Campaign runtime reconciliation is documented as an adapter-first plan.
- No production code is changed in this slice.
