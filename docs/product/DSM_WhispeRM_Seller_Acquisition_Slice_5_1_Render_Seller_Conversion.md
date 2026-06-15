# DSM WhispeRM Seller Acquisition Slice 5.1 — Render Seller Conversion

## Purpose

This slice converts a claimed Marketplace Acquisition seller into a Render seller account/profile after ownership attestation exists. It is seller-only conversion and intentionally does not convert inventory.

## Preconditions

Conversion is allowed only when all of the following are true:

- The `MarketplaceCapture` exists in the request tenant.
- The capture status is `CLAIMED`.
- A `DraftInventory` exists for the capture and remains linked to the claimed capture.
- A `MarketplaceSellerVerification` ownership attestation exists for the capture.
- No successful `SELLER` `RenderConversion` already exists for the same tenant, capture, and contact.

Unclaimed, expired, missing-attestation, cross-tenant, or missing-contact requests fail with explicit domain errors.

## Payload Mapping

The Render seller payload is built from captured/contact snapshot data only:

| Render field | Source |
| --- | --- |
| `name` | `MarketplaceCapture.sellerName`, then contact name fallback |
| `phone` | captured `metadata.sellerPhone`, then contact phone fallback |
| `email` | captured `metadata.sellerEmail`, then contact email fallback |
| `location` | captured `metadata.sellerLocation` |
| `marketplaceProfileUrl` | `MarketplaceCapture.sellerProfileUrl` |
| `marketplaceIdentifier` | `MarketplaceCapture.externalId`, then contact id fallback |
| `marketplaceSource` | captured `metadata.marketplaceSource` |
| `sourceCaptureId` | `MarketplaceCapture.id` |
| `sourceTenantId` | request/capture tenant id |

The connector does not re-scrape marketplace data and does not require TrustLayer fields.

## Connector Configuration

The HTTP connector reads configuration from environment variables:

- `RENDER_API_BASE_URL`
- `RENDER_API_KEY`

No production URL or secret is hard-coded. Tests use a mock connector and never call the real Render API.

## Idempotency Behavior

Before calling Render, the service checks for an existing successful seller conversion for the tenant/capture/contact. If one exists, it returns the stored `renderSellerId` without calling the connector again. New connector calls include an idempotency key scoped by tenant, capture, and contact.

## Failure Behavior

Connector failures mark the conversion `FAILED`, store a failure reason, and emit a failure audit event. This slice does not move the acquisition or draft inventory to `CONVERTED`; seller-only conversion status is stored separately on `RenderConversion`.

## Audit Events

The service records:

- `RENDER_SELLER_CONVERSION_STARTED`
- `RENDER_SELLER_CONVERSION_SUCCEEDED`
- `RENDER_SELLER_CONVERSION_FAILED`

Audit metadata includes tenant-safe ids for capture, contact, attestation, conversion, and successful Render seller id. Secrets and raw provider responses are not audited.

## Out of Scope

- Render inventory conversion
- Conversion retry framework
- TrustLayer verification or dependency
- Payment/escrow
- Analytics dashboard
- Claim portal behavior changes
- Marketplace re-scraping

## Follow-up Issues

- #147 Render Inventory Conversion
- #148 Conversion Retry & Recovery
