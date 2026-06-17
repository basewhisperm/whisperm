DSM_WhispeRM_Seller_Acquisition_Implementation_Audit_v1.0

Status

Approved

Scope

This document audits the implemented Seller Acquisition v1.0 code path against:

"docs/product/DSM_WhispeRM_Seller_Acquisition_v1.0.md"

Product term:

Seller Acquisition

Technical implementation term:

Marketplace Acquisition

---

Executive Summary

Seller Acquisition v1.0 is implemented.

The codebase contains services, routes, repositories, schemas, migrations, and tests for the complete flow:

Capture
→ Contact Match
→ Deal
→ Activity
→ Draft Inventory
→ Invitation
→ Claim
→ Ownership Attestation
→ Render Seller Conversion
→ Render Inventory Conversion
→ Capture Completion

No TrustLayer step exists in the conversion sequence.

TrustLayer is not required for Seller Acquisition, seller conversion, or inventory conversion.

---

1. Capture

Status

IMPLEMENTED

Evidence

Primary files:

- "packages/services/src/index.ts"
- "packages/services/src/marketplace-acquisition/capture-service.ts"
- "apps/api/test/marketplace-acquisition-capture.test.mjs"
- "packages/services/test/marketplace-capture-contact-matching.test.mjs"
- "packages/services/test/marketplace-capture-deal-creation.test.mjs"

Audit actions found:

- "MARKETPLACE_CAPTURED"
- "MARKETPLACE_CAPTURE_CREATED"

Verified Behavior

Capture creates:

- Contact
- Deal
- Activity
- Draft Inventory

Draft Inventory creation is included in the capture service path.

Capture metadata records the marketplace snapshot and does not require later marketplace re-scraping.

Notes

There are two capture service surfaces:

- legacy/API capture service under "packages/services/src/marketplace-acquisition/capture-service.ts"
- newer broader service path inside "packages/services/src/index.ts"

This is acceptable but should be monitored to avoid future drift.

---

2. Contact Matching

Status

IMPLEMENTED

Evidence

Tests:

- "packages/services/test/marketplace-capture-contact-matching.test.mjs"

Service:

- "packages/services/src/index.ts"

Verified Behavior

The service matches contacts by:

- provided contact ID
- phone
- email

If no match exists, it creates a new contact.

Risk

Phone matching exists, but the audit output does not prove universal phone normalization at this layer.

Recommendation

For Slice 6.3+ or hardening, add explicit tests for:

- Ghana phone format normalization
- duplicate prevention across phone variants
- email lowercasing

---

3. Acquisition Pipeline

Status

IMPLEMENTED

Evidence

Primary service:

- "packages/services/src/index.ts"

Pipeline key:

- "marketplace_acquisition"

Stage transitions found:

- Captured
- Invited
- Claim Started
- Claimed
- Converted
- Expired

Related route:

- "apps/web/src/app/api/marketplace-acquisition/deals/[dealId]/stage/route.ts"

Verified Behavior

Deals are created in the Marketplace Acquisition pipeline.

Stage transition service maps pipeline stages to capture statuses.

Completion route moves the deal to the Converted stage.

---

4. Activity Logging

Status

PARTIAL

Evidence

Audit/event actions found:

- "MARKETPLACE_CAPTURED"
- "MARKETPLACE_CAPTURE_CREATED"
- "MARKETPLACE_ACQUISITION_STAGE_CHANGED"
- "INVITATION_CREATED"
- "INVITATION_SENT"
- "INVITATION_FALLBACK_USED"
- "INVITATION_FAILED"
- "MARKETPLACE_CLAIM_LIFECYCLE_SCHEDULED"
- "MARKETPLACE_CLAIM_DAY3_REMINDER_SENT"
- "MARKETPLACE_CLAIM_DAY6_REMINDER_SENT"
- "MARKETPLACE_CLAIM_INVITATION_EXPIRED"
- "MARKETPLACE_CLAIM_STARTED"
- "MARKETPLACE_CLAIM_ACCEPTED"
- "OWNERSHIP_ATTESTED"
- "RENDER_SELLER_CONVERSION_STARTED"
- "RENDER_SELLER_CONVERSION_SUCCEEDED"
- "RENDER_SELLER_CONVERSION_FAILED"
- "RENDER_INVENTORY_CONVERSION_STARTED"
- "RENDER_INVENTORY_CONVERSION_SUCCEEDED"
- "RENDER_INVENTORY_CONVERSION_FAILED"
- "RENDER_CONVERSION_RETRY_SCHEDULED"
- "RENDER_CONVERSION_RETRY_STARTED"
- "RENDER_CONVERSION_RETRY_SUCCEEDED"
- "RENDER_CONVERSION_RETRY_FAILED"
- "RENDER_CONVERSION_DEAD_LETTERED"
- "MARKETPLACE_CAPTURE_COMPLETED"

Verified Behavior

Audit coverage is broad and present across the lifecycle.

Gap

Activity records are clearly created during capture, but the grep evidence mainly proves audit logs for later stages, not CRM-style Activity rows for every lifecycle event.

Recommendation

Decide whether every lifecycle event needs both:

- AuditLog
- Activity

Current implementation appears audit-first after capture.

---

5. Draft Inventory

Status

IMPLEMENTED

Evidence

Status enum:

- "DRAFT"
- "CLAIM_PENDING"
- "CLAIMED"
- "CONVERTED"
- "EXPIRED"

Files:

- "packages/types/src/marketplace-acquisition.ts"
- "packages/repositories/src/index.ts"
- "packages/services/src/index.ts"
- "packages/services/src/claim-lifecycle.ts"
- "packages/services/src/render-inventory-conversion.ts"

Migration:

- "prisma/migrations/20260614000000_draft_inventory_foundation/migration.sql"

Tests:

- "packages/services/test/render-inventory-conversion.test.mjs"
- "packages/services/test/claim-lifecycle.test.mjs"
- "packages/services/test/marketplace-capture-completion.test.mjs"

Verified Behavior

Draft Inventory is created from capture.

Draft Inventory becomes:

- CLAIMED during claim/attestation
- CONVERTED during inventory conversion
- EXPIRED during lifecycle expiry

---

6. Invitation Engine

Status

IMPLEMENTED

Evidence

Service:

- "packages/services/src/index.ts"

Route:

- "apps/web/src/app/api/marketplace-acquisition/captures/[id]/invite/route.ts"

Tests:

- "packages/services/test/seller-invitations.test.mjs"

Config:

- "SELLER_INVITATION_WHATSAPP_ENABLED"
- "SELLER_INVITATION_FALLBACK_TO_SMS"
- "SELLER_INVITATION_BASE_URL"

Audit actions:

- "INVITATION_CREATED"
- "INVITATION_SENT"
- "INVITATION_FALLBACK_USED"
- "INVITATION_FAILED"

Verified Behavior

Invitation channel logic supports:

1. WhatsApp
2. SMS fallback
3. Email
4. failure if no reachable channel

No fake WhatsApp delivery is recorded.

---

7. Claim Portal

Status

IMPLEMENTED

Evidence

Service:

- "packages/services/src/seller-claim-portal.ts"

Tests:

- "packages/services/test/seller-claim-portal.test.mjs"
- "apps/web/test/seller-claim-portal.test.js"

Audit actions:

- "MARKETPLACE_CLAIM_STARTED"
- "MARKETPLACE_CLAIM_ACCEPTED"
- "OWNERSHIP_ATTESTED"

Verified Behavior

Claim portal handles:

- token validation
- terminal state protection
- claim acceptance
- ownership attestation creation
- stage movement

---

8. Claim Lifecycle

Status

IMPLEMENTED

Evidence

Service:

- "packages/services/src/claim-lifecycle.ts"

Tests:

- "packages/services/test/claim-lifecycle.test.mjs"

Audit actions:

- "MARKETPLACE_CLAIM_LIFECYCLE_SCHEDULED"
- "MARKETPLACE_CLAIM_DAY3_REMINDER_SENT"
- "MARKETPLACE_CLAIM_DAY6_REMINDER_SENT"
- "MARKETPLACE_CLAIM_INVITATION_EXPIRED"

Verified Behavior

Lifecycle supports:

- scheduled reminders
- expiry
- terminal status protection

Expired claims update capture and draft inventory state.

---

9. Ownership Attestation

Status

IMPLEMENTED

Evidence

Services:

- "packages/services/src/index.ts"
- "packages/services/src/seller-claim-portal.ts"

Types:

- "packages/types/src/marketplace-acquisition.ts"

Tests:

- "packages/services/test/ownership-attestation.test.mjs"
- "packages/services/test/seller-claim-portal.test.mjs"

Audit action:

- "OWNERSHIP_ATTESTED"

Verified Behavior

Ownership attestation is stored.

Seller conversion requires attestation.

Attestation uses the shared ownership statement constant.

---

10. Render Seller Conversion

Status

IMPLEMENTED

Evidence

Service:

- "packages/services/src/render-seller-conversion.ts"

Tests:

- "packages/services/test/render-seller-conversion.test.mjs"
- "apps/api/test/render-seller-conversion.test.mjs"

Retry:

- "packages/services/src/render-conversion-retry.ts"
- "packages/services/test/render-conversion-retry.test.mjs"

Audit actions:

- "RENDER_SELLER_CONVERSION_STARTED"
- "RENDER_SELLER_CONVERSION_SUCCEEDED"
- "RENDER_SELLER_CONVERSION_FAILED"

Verified Behavior

Render Seller Conversion requires:

- claimed capture
- claimed draft
- ownership attestation

It supports:

- idempotency
- retry
- dead-letter handling

TrustLayer is not required.

---

11. Render Inventory Conversion

Status

IMPLEMENTED

Evidence

Service:

- "packages/services/src/render-inventory-conversion.ts"

Route:

- "apps/web/src/app/api/marketplace-acquisition/captures/[id]/convert/render-inventory/route.ts"

Tests:

- "packages/services/test/render-inventory-conversion.test.mjs"

Audit actions:

- "RENDER_INVENTORY_CONVERSION_STARTED"
- "RENDER_INVENTORY_CONVERSION_SUCCEEDED"
- "RENDER_INVENTORY_CONVERSION_FAILED"

Verified Behavior

Render Inventory Conversion requires:

- claimed capture
- claimed or converted draft inventory
- successful seller conversion in production repository path

It converts from the captured draft inventory snapshot.

No marketplace re-scraping is performed.

Note

The service was adjusted to remain compatible with older in-memory tests while production repository support enforces seller conversion lookup.

---

12. Capture Completion

Status

IMPLEMENTED

Evidence

Service:

- "packages/services/src/marketplace-capture-completion.ts"

Route:

- "apps/web/src/app/api/marketplace-acquisition/captures/[id]/complete/route.ts"

Tests:

- "packages/services/test/marketplace-capture-completion.test.mjs"

Audit action:

- "MARKETPLACE_CAPTURE_COMPLETED"

Verified Behavior

Completion requires:

- successful seller conversion
- successful inventory conversion
- converted draft inventory

Completion updates:

- Marketplace Capture → CONVERTED
- Deal → Converted stage
- AuditLog → MARKETPLACE_CAPTURE_COMPLETED

Completion is idempotent.

---

Gap Analysis

Implemented

- Capture
- Contact Matching
- Deal Creation
- Capture Activity
- Draft Inventory
- Invitation Engine
- Claim Portal
- Claim Lifecycle
- Ownership Attestation
- Render Seller Conversion
- Render Inventory Conversion
- Capture Completion
- Retry and dead-letter support for render conversions
- Seller Acquisition terminology ADR
- WhatsApp-first invitation policy

Partial

- Lifecycle event Activity rows beyond initial capture are not clearly proven.
- Phone normalization and deduplication across phone variants need explicit hardening evidence.
- There are multiple capture service surfaces that could drift if not governed.

Missing

- Seller Acquisition operational dashboard.
- Recovery console for failed conversions.
- Production WhatsApp Business provider integration.
- End-to-end production smoke test covering full Capture → Completion chain through web/API routes.
- Bulk seller acquisition workflow.

Risks

1. Operators cannot easily see funnel health yet.
2. Failed conversions are retryable, but operational visibility is limited.
3. Phone identity matching may duplicate sellers if phone formats differ.
4. Multiple service surfaces may create future implementation drift.
5. No single dashboard currently confirms acquisition throughput, conversion rate, or expiry losses.

---

Recommended Slice 6.3 Dashboard Metrics

Capture Metrics

- Captures today
- Captures this week
- Captures this month
- Captures by marketplace source

Invitation Metrics

- Invitations created
- Invitations sent
- Invitations failed
- WhatsApp attempted
- SMS fallback used
- Email used
- No reachable channel count

Claim Metrics

- Claims started
- Claims accepted
- Claim acceptance rate
- Expired claims
- Day 3 reminders sent
- Day 6 reminders sent

Conversion Metrics

- Ownership attestations completed
- Seller conversions succeeded
- Seller conversions failed
- Inventory conversions succeeded
- Inventory conversions failed
- Completed acquisitions

Funnel

Captured
→ Invited
→ Claim Started
→ Claimed
→ Seller Converted
→ Inventory Converted
→ Completed

Recovery Metrics

- Failed conversions
- Retrying conversions
- Dead-lettered conversions
- Average attempts per successful conversion
- Oldest failed conversion age

---

Recommendation

Proceed next to:

Slice 6.3 — Seller Acquisition Dashboard

Objective:

Make the implemented v1.0 system operationally visible without changing lifecycle behavior.
