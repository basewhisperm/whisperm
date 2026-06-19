# Seller Acquisition Remaining Work SOT v1.0

## Purpose

This is the canonical source of truth for preventing Seller Acquisition drift while the remaining work is completed. When older slice documents, route names, or implementation notes disagree with this document, treat this document as the product-direction baseline and mark the disagreement as verify-needed before changing behavior.

This document is documentation-only. It does not assert that every item below is already implemented unless the item is explicitly listed as completed or observed. Do not invent completed work; unresolved implementation status must remain verify-needed until proven by current code, tests, or production evidence.

## Canonical lifecycle

The canonical Seller Acquisition lifecycle is:

1. Capture
2. Contact
3. Deal
4. Draft Inventory
5. Invite
6. Claim
7. Ownership Attestation
8. Seller Conversion
9. Inventory Conversion
10. Complete

Use these lifecycle names consistently in product documentation, implementation plans, tests, and operations notes. Avoid introducing alternate lifecycle names or parallel state machines unless a migration and rollout plan is approved.

## Canonical proof and verification rules

- TrustLayer is not required for this workflow.
- TrustLayer must not be inserted as a prerequisite for claim, seller conversion, inventory conversion, or completion.
- Ownership Attestation is the canonical claim proof for Seller Acquisition.
- MarketplaceSellerVerification is legacy/non-canonical unless current code proves otherwise.
- If current code still references MarketplaceSellerVerification, treat that reference as a compatibility or migration concern until verified. Do not expand MarketplaceSellerVerification as the canonical proof model without an explicit product and migration decision.

## Route ownership

- `apps/web` routes are production-facing for Seller Acquisition user and app-router flows.
- `apps/api` routes may exist for platform API handlers, service coverage, or historical compatibility, but they are not the only source of truth.
- Route ownership must be verified against current code before deleting, replacing, or moving any endpoint.
- Business logic should remain in tenant-scoped services and repositories so route handlers stay thin and route ownership can evolve without changing domain behavior.

## Remaining-work guardrails

### Documentation and planning

- Keep this SOT, `docs/product/seller-acquisition/AGENTS.md`, and operational migration notes aligned in the same PR when Seller Acquisition lifecycle semantics change.
- Mark uncertain implementation status as verify-needed.
- Do not claim a slice, migration, endpoint, or conversion step is complete unless current code, tests, or production records prove it.

### Tenant isolation and security

- Every capture, contact, deal, invitation, claim, attestation, conversion, and completion operation must remain tenant-scoped.
- Claim tokens must remain opaque to sellers and must not expose tenant data, seller PII, or internal identifiers unnecessarily.
- Logs and audit events must avoid secrets and sensitive fields while preserving correlation IDs and tenant-safe identifiers.

### Conversion semantics

- Seller Conversion occurs after Claim and Ownership Attestation.
- Inventory Conversion occurs after Seller Conversion.
- Complete occurs only after required seller and inventory conversion outcomes are verified.
- TrustLayer verification, trust scores, or post-conversion TrustLayer workflows are outside this lifecycle and must not block completion.

## Neon migration baseline record

The documented Neon baseline for Seller Acquisition migration work is:

1. The first two migrations were marked applied.
2. The remaining Seller Acquisition migrations were deployed.
3. The final migrate status was `Database schema is up to date`.

This record documents the baseline that was performed. Before relying on it for future production work, verify the target Neon project, branch, `_prisma_migrations` rows, and current repository migration history.

## Production migration safety warnings

- Never run `prisma migrate reset` against Neon production or any shared Neon branch.
- Use `prisma migrate deploy`, not `prisma migrate dev`, for production migration work.
- Verify `DATABASE_URL` before any migration operation.
- Confirm the Neon project, branch, database role, and target environment before running Prisma commands.
- Prefer read-only verification before baselining or deploying migrations.
- Ensure a restorable backup or snapshot exists before production migration work.

## Verify-needed register

The following items must be verified against current code or production records before being represented as complete:

- Whether any production-facing Seller Acquisition route still depends on `MarketplaceSellerVerification`.
- Whether any `apps/api` route remains externally consumed by production clients instead of only service or compatibility coverage.
- Whether all lifecycle transitions above have route-level and service-level coverage in the current test suite.
- Whether production `_prisma_migrations` still matches the documented Neon baseline after subsequent deployments.
