# ST1-013N Contract Inventory

V1/demo-critical API routes for the golden path: capture → qualification → campaign
assignment → invitation → claim → conversion readiness → CRM contact / draft inventory
visibility → dashboard status.

Response envelope legend:
- **V1 envelope** — migrated onto `apiSuccess`/`apiFailure` (`apps/web/src/app/api/_lib/api-response.ts`): `{ ok: true, data }` / `{ ok: false, error: { code, message, details? } }`, `code` drawn from the closed `ApiErrorCode` set.
- **Legacy `{ok,data}`-shaped** — already returns `{ok, ...}` but not yet migrated onto the shared helper (not demo-critical enough to justify the reshape/test-update in this slice).
- **Legacy other** — a route-specific shape kept intentionally (documented per-row why).

| Route | Method | Owner | Request Validation | Response Shape | Auth | Tenant Scoped | Campaign Scoped | Runtime Side Effect | Tests |
|---|---|---|---|---|---|---|---|---|---|
| `/api/marketplace-acquisition/captures` | POST | `MarketplaceAcquisitionCaptureService` | listingUrl/sourceUrl format, body size cap (96KB); campaignId is best-effort (soft-fails into `data.campaignAssignment`, see below) | **V1 envelope**. `data` = capture result fields + optional `campaignAssignment: {status: COMPLETED\|ALREADY_ASSIGNED\|FAILED}` | Clerk session (`getTenantContextForCurrentUser`) + `SELLER_ACQUISITION` feature gate | Yes (`tenantId` from session, never client input) | Best-effort: campaign assignment failure is reported, never silently swallowed, and durably audited (`MARKETPLACE_CAPTURE_CAMPAIGN_ASSIGNMENT_FAILED`) | Creates `MarketplaceCapture` (+ `Contact`/`Deal` when qualified), optionally `SellerAcquisitionCampaignMember` | `apps/web/test/marketplace-capture-route.test.js`, `apps/web/test/v1-api.contract.test.js` |
| `/api/marketplace-acquisition/records` | GET | `SellerAcquisitionRecordService` | `limit` must be a positive integer if present; `campaignId`/`cursor` optional strings | **V1 envelope**. `data: { records[], nextCursor? }` | Same as above | Yes | `campaignId` query param scopes the list; unknown/foreign campaignId yields zero records, never another tenant's | Read-only | `apps/web/test/v1-api.contract.test.js`, `packages/services/test/seller-acquisition-records.test.mjs` |
| `/api/marketplace-acquisition/records/[captureId]` | GET, PATCH | `SellerAcquisitionRecordService` / `SellerAcquisitionEditService` | `captureId` required (400 if empty); PATCH body validated by `editExtractInputSchema` (zod, cross-package) | **V1 envelope**. GET `data: {record}`; PATCH `data: {record, ...editResult}` | Same as above | Yes | N/A (capture-scoped, not campaign-scoped) | PATCH may trigger requalification + campaign re-check | `apps/web/test/marketplace-acquisition-requalification.test.js`, `apps/web/test/seller-acquisition-edit.test.js` |
| Campaign seller **list**: `/api/marketplace-acquisition/campaigns/[campaignId]/discovery/sellers` | GET | `PrismaMarketplaceDiscoveryRepository` | `campaignId` required; `status` must be one of the known `DiscoveredSellerRecord.status` values | **V1 envelope**. `data: {sellers[], total}` | Same as above | Yes | Yes — `listDiscoveredSellersByCampaign` filters by `(tenantId, campaignId)` | Read-only | No dedicated route test yet (repository-level coverage only) — **known gap** |
| Campaign seller **promote**: `.../discovery/sellers/[sellerId]/promote` | POST | `MarketplaceDiscoveryService.promoteSellerToCapture` | `campaignId`/`sellerId` required (400 if empty) | **V1 envelope**. `data` = promotion result | Same as above | Yes | **Yes** — fetches seller, verifies `seller.campaignId === campaignId`, denies with `SELLER_NOT_IN_CAMPAIGN` (409) otherwise | Routes through canonical capture pipeline; creates/updates `MarketplaceCapture`, `Contact`, `Deal`, `SellerAcquisitionCampaignMember` | `apps/web/test/discovery-promote-route.test.js`, `packages/services/test/discovery-promotion.test.mjs` (incl. two-campaign isolation proof) |
| Campaign seller **reject**: `.../discovery/sellers/[sellerId]/reject` | POST | `MarketplaceDiscoveryService.rejectSeller` | `campaignId`/`sellerId` required (400 if empty) | **V1 envelope**. `data: {seller}` | Same as above | Yes | **Yes (fixed in this slice)** — previously ignored `campaignId` entirely; a `sellerId` from any campaign in the tenant could be rejected via any campaign's URL. Now verifies `seller.campaignId === campaignId`, denies with `SELLER_NOT_IN_CAMPAIGN` (409) otherwise | Updates `DiscoveredMarketplaceSeller.status` | `apps/web/test/discovery-reject-route.test.js`, `packages/services/test/discovery-promotion.test.mjs` |
| Invitation **create/send**: `/api/marketplace-acquisition/captures/[id]/invite`, `/captures/bulk-invite` | POST | `CampaignRuntimeService.executeInvitation` | `sellerInvitationCreateRequestSchema` (invite) / `bulkInviteRequestSchema` (bulk, zod `.strict()`, `channel` enum) | Legacy `{ok, invitationId, executionId, status, channel}` (invite) / `{ok, summary, results[]}` (bulk) — **not** migrated to the `data`-nested envelope in this slice (would require reshaping UI callers); `channel` field added in this slice (previously omitted) | Same as above + `authorizeAcquisitionActionForApi` (governance) | Yes | Yes (`campaignId` resolved via eligibility check, passed to governance + execution) | Creates `CampaignRuntimeExecution`, `MarketplaceSellerInvitation`, `MarketplaceClaimToken`; sends via provider adapter | `apps/web/test/seller-invite-route-sms.test.js`, `apps/web/test/global-invitation-contract.test.js`, `apps/web/test/seller-acquisition-route-activity.test.js` |
| Invitation **retry**: `.../campaigns/[campaignId]/runtime/executions/[executionId]/retry` | POST | `CampaignRuntimeService.retryInvitationExecution` | `executionId` resolved + verified to belong to `campaignId`; 404 otherwise | Legacy `{ok, data: {executionId, status, retryCount, nextRetryAt, channel}}` | Same as above + governance | Yes (`findById` is tenant-scoped) | Yes (execution's own `campaignId` verified against the URL param) | May re-enqueue/re-dispatch invitation | `packages/services/test/campaign-runtime.test.mjs` (channel-fidelity regression tests) |
| Seller claim **token/preview**: `/api/marketplace-acquisition/claims/[token]` | GET | `SellerClaimPortalService.preview` | Token resolved via SHA-256 hash lookup; empty/malformed token → 400 `VALIDATION_ERROR` (fixed in this slice, was an uncaught 500) | Legacy `{...preview}` / `{error, code}` — unauthenticated public route, intentionally does not use the `{ok,data}` envelope (raw token never present in the body; PII masked) | **None (intentionally public)** — security boundary is the 256-bit random token + SHA-256 hash, not a session | N/A (tenant resolved from the token itself, not an actor) | N/A | Read-only, but may opportunistically advance capture stage to "Claim Started" | `packages/services/test/seller-claim-portal.test.mjs`, `apps/web/test/seller-claim-portal.test.js` |
| Seller claim **portal/accept**: `/api/marketplace-acquisition/claims/[token]/accept` | POST | `SellerClaimPortalService.accept` | `acceptInputSchema` (`acceptedTerms: true` required, zod); malformed token → 400 (fixed in this slice) | Legacy `{...result}` / `{error, code}` — same public-route rationale as above | None (public, token-authenticated) | N/A | N/A | Claims capture + draft, creates `MarketplaceOwnershipAttestation`, enriches (never creates) CRM records | `packages/services/test/seller-claim-portal.test.mjs`, `apps/web/test/marketplace-acquisition-crm-conversion.test.js` |
| Conversion readiness: `/api/marketplace-acquisition/captures/[id]/complete`, `/captures/[id]/convert/render-inventory`, `/captures/[id]/convert/render-seller` | POST | `MarketplaceCaptureCompletionService`, `RenderInventoryConversionService`, `RenderSellerConversionService` | Category/condition enums validated; capture must be `CLAIMED` | Legacy `{ok,...}` shapes, not migrated in this slice | Same as records routes | Yes | N/A (capture-scoped) | Converts draft inventory / creates Render seller record | `apps/web/test/marketplace-acquisition-crm-conversion.test.js`, `apps/web/test/seller-acquisition-route-activity.test.js` |
| `/api/health` | GET | — | None (unauthenticated infra probe) | **Intentionally not the V1 envelope** — flat `{ok, service, database, timestamp}`, unauthenticated, excluded from Clerk middleware for load-balancer/uptime-monitor compatibility; reshaping this is out of scope (external monitors may already depend on the flat shape) | None (explicitly public) | N/A | N/A | `SELECT 1` only | `apps/web/test/health-route.test.js` |
| `/api/marketplace-acquisition/provider-health` | GET | — | `channel` query param must be one of `WHATSAPP\|SMS\|EMAIL` | **V1 envelope** (migrated in this slice). `data: {provider, channel, claimBaseUrlConfigured}` / failure `error.details: {code, missingEnv?, invalidEnv?}` | Clerk session + feature gate | Yes | N/A | Read-only (env/config probe) | `apps/web/test/provider-health-route.test.js` |
| `/api/marketplace-acquisition/runtime-health` | GET | — | None (no inputs) | **V1 envelope** (migrated in this slice) | Clerk session + feature gate | Yes | N/A (aggregates across the tenant's campaigns) | Read-only | `apps/web/test/acquisition-runtime-health.test.js` |

## Response contract decisions

1. **Canonical envelope**: `ApiSuccess<T> = {ok:true, data:T}`, `ApiFailure = {ok:false, error:{code, message, details?}}`
   (`apps/web/src/app/api/_lib/api-response.ts`). `code` is drawn from a closed `ApiErrorCode` union
   (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `TENANT_SCOPE_VIOLATION`,
   `CAMPAIGN_SCOPE_VIOLATION`, `SELLER_NOT_IN_CAMPAIGN`, `CAPTURE_ASSIGNMENT_FAILED`,
   `INVITATION_NOT_ELIGIBLE`, `INVITATION_CHANNEL_MISMATCH`, `QUEUE_JOB_FAILED`, `RUNTIME_UNAVAILABLE`,
   `FEATURE_NOT_ENABLED`, `INTERNAL_ERROR`). `apps/web/src/app/api/_lib/service-error.ts` maps
   `ServiceError`/`PersistenceError` internal codes onto this closed set so route handlers don't
   hand-roll the mapping per call site.
2. **Migration scope**: only routes in the table above were migrated. The rest of `apps/web/src/app/api`
   (deals, contacts, dashboard, reports, workspaces, campaign CRUD, growth, members, analytics,
   command-center, notifications webhook, usage) is out of scope for this slice — not on the V1
   golden path.
3. **Intentionally unmigrated rows**: `/api/health` (public infra contract, external consumers),
   the claim token/portal routes (public, token-authenticated, pre-existing PII-safe shape), and
   the invite/bulk-invite/retry/conversion routes (reshaping their success envelope would require
   updating every UI caller that reads `body.invitationId`/`body.status` etc. directly — deferred;
   their *failure* paths already return a `code`, and `channel`/`nextRetryAt` visibility was added
   without changing the top-level shape).
4. **Validation policy**: malformed/empty path IDs (`captureId`, `campaignId`, `sellerId`, claim
   `token`) return 400 `VALIDATION_ERROR` before any repository/service call. Missing required body
   fields return 400. Wrong tenant returns 404 (captures/records: repository-level "not found",
   never a 403 that would confirm the record exists under another tenant). Wrong campaign
   membership returns 409 `SELLER_NOT_IN_CAMPAIGN` (a specific, more actionable code than a bare
   404/409, per the DiscoveryPromotionError contract both promote and reject now share).

## Isolation decisions

- **Tenant isolation convention**: every tenant-scoped read/write takes `{tenantId}` from the
  server-side Clerk session (`getTenantContextForCurrentUser`/`getTenantForCurrentUser`), never
  from client input. Repository methods filter `WHERE tenantId = ...` (Prisma `@@unique([tenantId,
  id])` on every tenant-scoped model). A request for another tenant's resource resolves to "not
  found" (404), not a 403 that would leak existence. Proven for captures/records at
  `packages/services/test/seller-acquisition-records.test.mjs` ("tenant A cannot read tenant B
  capture...") and for discovery/promotion at `packages/services/test/discovery-promotion.test.mjs`
  ("tenant isolation..." tests).
- **Campaign isolation convention**: campaign-scoped mutations (promote, reject) now require and
  verify `(tenantId, campaignId, sellerId)` together — the seller row's own `campaignId` is
  compared against the URL's `campaignId`, not just its `tenantId` against the session. **This
  slice fixes a real bug**: `rejectSeller` previously took only `(context, sellerId)` and the route
  never read `campaignId` from its own URL at all, so any seller belonging to the tenant could be
  rejected via any campaign's URL. Fixed by mirroring the already-correct `promoteSellerToCapture`
  pattern. Regression proof: `packages/services/test/discovery-promotion.test.mjs` ("campaign
  isolation: the same seller identity can exist independently in campaign A and campaign B") and
  `apps/web/test/discovery-reject-route.test.js`.
- **Seller claim token isolation**: the public claim routes are tenant-blind by design at the
  lookup step (`findByTokenHash` has no tenant filter — the security boundary is the 256-bit
  random token + SHA-256 hash, not a session), with tenant scope established from the resolved
  token for every subsequent write. This is pre-existing, intentional behavior, not a gap.

## Runtime proof

- `apps/worker/test/durable-queue-runtime.test.js` exercises the real production call chain
  (`enqueue` → `runDurableQueuePollLoop`/`claimAndProcessOneDurableQueueJob` → `WorkerApplication.processJob`
  → persist outcome) against a fake repository that mirrors `PrismaQueueJobRepository`'s exact
  claim/lock/dedup semantics (Postgres-specific `updateMany` conditional-claim behavior is covered
  separately by `packages/repositories/test/queue-job.test.mjs`, which does run against a
  Prisma-shaped fake). This slice adds:
  - a real `enqueue()` implementation on the fake (previously stubbed to throw), matching
    `PrismaQueueJobRepository`'s unique-on-`(tenantId, queueName, jobKey)` dedup contract;
  - an end-to-end **enqueue → poll loop → handler → COMPLETED** test asserting the handler's side
    effect is observable in an external store exactly once;
  - a **duplicate-enqueue** test proving a second `enqueue()` call under the same `jobKey` returns
    the existing row (not a new one) and the handler's side effect is never duplicated, including
    after the job has already completed.
- No real Postgres is provisioned in this repository's CI (`.github/workflows/ci.yml`) — this was
  true before this slice and remains true; all worker/repository tests run against fake, Prisma-shaped
  in-memory stores, consistent with every other package's test convention in this repo.

## Invitation channel authority

`resolveExecutionChannel(metrics)` (`packages/services/src/campaign-runtime.ts`, exported from
`@whisperm/services`) is now the single implementation of the `metrics.channel ??
metrics.selectedChannel` fallback, replacing three previously-duplicated inline copies
(`retryInvitationExecution`, `AcquisitionRuntimeHealthService`'s channel-usage report,
`invitation-execution-response.ts`). See `docs/runtime/status-vocabulary.md` for the full authority
contract and regression test references. The invite/bulk-invite/retry API responses now also
surface the resolved `channel` (previously omitted).

## Known gaps / follow-ups (not closed in this slice)

- **Campaign seller list route** (`.../discovery/sellers` GET) has no dedicated route-level test
  (only repository-level coverage via `packages/repositories/src/marketplace-discovery.ts`'s
  callers). Low risk — it's a read-only, already-tenant-and-campaign-scoped query — but should get
  a route test alongside the next change that touches it.
- **Golden-path Playwright UI coverage for campaign promote/reject** was not added in this slice:
  this sandbox has no live Postgres/Clerk/Next server available to write *and verify* a new spec
  responsibly (this repo's own CI has never provisioned a real database either — see
  `.github/workflows/ci.yml`), and the reject button in
  `apps/web/src/app/(app)/marketplace-acquisition/campaigns/[campaignId]/discovery/page.tsx` has no
  accessible name/`data-testid` today (icon-only). The service- and route-level tests above are the
  executed, verified proof of the campaign-isolation fix; a UI-level golden-path spec for
  promote/reject is a recommended follow-up once selectors are added.
- **`e2e-required` CI job** (`.github/workflows/ci.yml`) is wired but not yet a blocking check
  (`continue-on-error: true`) because this repository has no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`/
  Clerk secrets configured. Required secrets to unblock it: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (all as GitHub Actions repo/environment
  secrets — see `apps/web/e2e/README.md`). Once added, remove `continue-on-error: true` from the
  `e2e-required` job.
- **Invite/bulk-invite/retry/conversion routes** were not reshaped onto the `apiSuccess`/`apiFailure`
  envelope (see "Intentionally unmigrated rows" above) — their failure paths already carry a stable
  `code`, but a future slice could finish the migration once UI callers are updated in the same
  change.
