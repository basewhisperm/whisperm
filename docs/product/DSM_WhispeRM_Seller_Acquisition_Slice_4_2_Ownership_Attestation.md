# DSM WhispeRM Seller Acquisition Slice 4.2 — Ownership Attestation

## Purpose

Slice 4.2 adds immutable ownership attestation to seller claim acceptance. When a seller accepts a claim, WhispeRM records evidence that the claimant stated they are the owner or authorized representative of the marketplace seller profile and associated captured inventory.

## Attestation statement

Every ownership attestation stores this exact statement:

> I confirm that I am the owner or authorized representative of this seller profile and that I am authorized to claim the associated inventory.

The backend stores this stable statement with each attestation record and does not rely only on frontend copy.

## Model summary

`MarketplaceOwnershipAttestation` stores tenant-scoped claim evidence:

- tenant, marketplace capture, draft inventory, and claim token references
- claimant name, optional phone/email, and optional marketplace identity
- accepted terms flag and immutable attestation statement
- request evidence metadata including IP address and user agent
- attested/created timestamps

A unique constraint on `tenantId + marketplaceCaptureId` prevents duplicate attestations for the same captured marketplace seller profile.

## Claim flow integration

Claim acceptance now requires:

1. a valid tenant-scoped claim token
2. a non-expired token and claimable acquisition/draft inventory state
3. claimant name
4. `acceptedTerms: true`
5. creation of a `MarketplaceOwnershipAttestation` in the same claim transaction

A successful response includes `attestationId` and never returns raw claim tokens, IP address, or user agent.

## Immutability rule

Attestations are append-only. The service and public API only create attestation records; they do not expose update logic for submitted attestations.

## Security notes

- Tenant isolation is enforced through tenant-scoped repository lookups and writes.
- Raw claim tokens are hashed for lookup and are not returned or written to audit metadata.
- Audit event `OWNERSHIP_ATTESTED` records tenant, capture, draft inventory, attestation, and claim token identifiers.
- TrustLayer verification is intentionally not required for claim acceptance.

## Out of scope

- Render seller conversion
- Render inventory conversion
- TrustLayer verification
- Analytics dashboard
- Payment/escrow
- New invitation channels
- Full legal document signing platform

## Follow-up issues

- #146 Render seller conversion
- #147 Render inventory conversion
