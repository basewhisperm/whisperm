# DSM WhispeRM Seller Acquisition Slice 4.1 — Seller Claim Portal

## Purpose

This slice adds a public seller-facing claim portal for invited marketplace sellers. A seller can open a claim link, review the captured seller and inventory snapshot, and accept ownership without requiring TrustLayer verification or Render conversion.

## Route

- Web portal: `/claim/[token]`
- The token is read from the URL and sent only to claim API endpoints.
- The portal displays captured snapshot data only; it does not re-scrape the marketplace listing.

## API endpoints

- `GET /api/marketplace-acquisition/claims/[token]`
  - Returns safe preview data: token status, expiration, capture id/source/listing URL, masked seller contact fields, draft inventory snapshot, and current acquisition stage.
- `POST /api/marketplace-acquisition/claims/[token]/accept`
  - Accepts `{ "claimantName": "...", "acceptedTerms": true }`.
  - Requires `acceptedTerms` to be true.
  - Returns `{ status: "CLAIMED", captureId, draftInventoryId, claimedAt }` on success.

## Security rules

- Claim tokens are resolved by SHA-256 hash; raw tokens are not stored or returned in API responses.
- Token hash comparison uses constant-time comparison after lookup.
- Public claim endpoints derive tenant scope from the token record and tenant-scope all subsequent reads/writes.
- Seller phone and email are masked in preview responses.
- Expired tokens are rejected for acceptance.
- Claimed, converted, or expired captures cannot be claimed again into a new state.
- No TrustLayer dependency is introduced.

## Claim state transitions

- Valid preview:
  - If the capture is `INVITED`, the portal moves it to `CLAIM_STARTED` and moves the acquisition deal to `Claim Started`.
  - Preview never moves terminal `CLAIMED`, `CONVERTED`, or `EXPIRED` records.
- Accept ownership:
  - Moves acquisition to `Claimed`.
  - Marks the claim token as `CLAIMED`.
  - Marks `MarketplaceCapture.status` as `CLAIMED`.
  - Marks the associated `DraftInventory.status` as `CLAIMED`.
  - Records audit events for claim start and acceptance.

## Out of scope

- Ownership attestation service beyond the acceptance checkbox/text.
- TrustLayer verification.
- Payment or escrow.
- Analytics dashboard.
- Marketplace re-scraping.
- New invitation channel system.

## Follow-up issues

- #145 Ownership Attestation.
- #146 / #147 Render seller and inventory conversion.
