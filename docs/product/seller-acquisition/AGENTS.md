# Seller Acquisition Engineering Notes

Scope: Seller Acquisition product, API, web route, service, repository, and operations work.

## Canonical lifecycle

The canonical lifecycle is Capture → Contact → Deal → Draft Inventory → Invite → Claim → Ownership Attestation → Seller Conversion → Inventory Conversion → Complete. Route-level tests should exercise handlers for each externally visible transition instead of asserting against source text. `docs/product/SOT_Seller_Acquisition_Remaining_Work_v1.0.md` is the canonical drift-prevention SOT for remaining work.

## Claim and attestation path

TrustLayer is not required for this workflow. Ownership Attestation is the canonical claim proof.

The canonical claim URL is `/claim/[token]`, backed by `/api/marketplace-acquisition/claims/[token]` for preview and `/api/marketplace-acquisition/claims/[token]/accept` for acceptance. The token is opaque to the seller and must be resolved by hash only.

`SellerClaimPortalService.accept()` is the canonical ownership attestation path. It validates terms acceptance, creates the ownership attestation, moves the capture and draft inventory to claimed state, and records audit/activity events. Future engineers must not create a parallel attestation flow.

`OwnershipAttestationService` is retired for this lifecycle. Do not add new route, retry, or worker dependencies on it. Use the claim portal acceptance flow instead.

`MarketplaceSellerVerification` is legacy/non-canonical unless current code proves otherwise. Conversion retry/recovery should operate on `RenderConversion` state and the canonical ownership attestation records, not legacy marketplace seller verification rows. Treat remaining references as verify-needed compatibility or migration concerns until proven otherwise.

## Conversion architecture

Seller conversion is performed after claim acceptance. The seller conversion route delegates to `RenderSellerConversionService.convertClaimedSellerToRender()`, which requires the claimed capture and ownership attestation before creating or reusing a Render seller conversion.

Inventory conversion is performed after seller conversion. The inventory conversion route delegates to `RenderInventoryConversionService.convertClaimedInventoryToRender()`, which converts the claimed draft inventory and stores the successful inventory conversion result.

Completion is separate from conversion. The completion route delegates to `MarketplaceCaptureCompletionService.completeCapture()`, verifies successful seller and inventory conversions, moves the capture to converted, and moves the acquisition deal to the Converted pipeline stage when the pipeline is available.

## Pipeline key convention

The Seller Acquisition pipeline key is `marketplace_acquisition`. Use the exported constant when working in seed code and shared modules; do not hand-type alternate keys such as `seller_acquisition` or display-name variants. Route handlers and services that need stage movement should resolve by this key and then by canonical stage names.

## Deployment responsibilities

`apps/web` routes are production-facing for Seller Acquisition user and app-router flows. `apps/api` routes may exist for platform API handlers, service coverage, or historical compatibility, but they are not the only source of truth. Verify current route ownership before deleting, replacing, or moving endpoints.

Keep business behavior in services and repositories so both API and web entry points can stay thin. Route handlers should validate/authenticate, construct tenant-scoped context, call the service, and format HTTP responses.

## Drift avoidance

When changing this lifecycle, update tests, product docs, and operations docs in the same PR. Do not update UI text or source assertions as a substitute for route-level coverage. Avoid new status names, pipeline keys, or duplicate conversion concepts unless a migration and rollout plan is documented.

## Deferred items

SA-06 Dashboard Refresh is cosmetic and intentionally deferred until after lifecycle hardening. Handle it in a separate UI-focused pass.

SA-07 Migration Hygiene is documentation-only in this pass. Historical duplicate timestamp prefix `20260614000000` is a known naming hygiene issue with no current production impact; do not rename applied migrations.
