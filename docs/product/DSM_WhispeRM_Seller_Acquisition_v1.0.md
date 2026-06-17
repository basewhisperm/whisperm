DSM_WhispeRM_Seller_Acquisition_v1.0

Status

Approved

Purpose

Seller Acquisition is WhispeRM's marketplace growth engine.

Its purpose is to identify marketplace sellers, capture seller and listing information, invite sellers into the ecosystem, and convert those sellers and their inventory into Render.

WhispeRM acquires sellers.

Render owns sellers.

Render owns inventory.

TrustLayer has no role in Seller Acquisition, seller onboarding, seller conversion, or inventory conversion.

TrustLayer services, if used, occur only after conversion is complete and the seller already exists in Render.

Terminology

Product Terminology

The product and business term is:

Seller Acquisition

Technical Terminology

For backward compatibility, implementation assets may continue to use:

marketplace-acquisition

marketplace_acquisition

Examples:

/marketplace-acquisition/*

marketplace_acquisition pipeline key

marketplace_acquisition.* permissions

No migration is required.

Reference:

ADR_Seller_Acquisition_Terminology.md

Seller Acquisition Lifecycle

1. Capture

WhispeRM captures a seller and marketplace listing.

Capture creates:

Contact

Acquisition Deal

Activity

Draft Inventory

The captured listing becomes the system-of-record snapshot.

Marketplace content is not re-scraped during conversion.

2. Contact Matching

Captured sellers are matched against existing contacts.

If a matching contact exists:

Contact is reused.

If no contact exists:

New contact is created.

3. Deal Creation

A Seller Acquisition Deal is created in the acquisition pipeline.

Purpose:

measure acquisition performance

support funnel reporting

track seller lifecycle progression

4. Activity Creation

Seller acquisition activity is recorded for auditability and reporting.

Examples:

capture created

invitation sent

seller claimed

ownership attested

conversion completed

5. Draft Inventory

Every captured marketplace listing becomes Draft Inventory.

Draft Inventory is owned by WhispeRM until claim and conversion.

Statuses

DRAFT

CLAIM_PENDING

CLAIMED

CONVERTED

EXPIRED

6. Seller Invitation

Captured sellers receive invitations.

Channel Priority

WhatsApp

SMS

Email

Rules:

Cellphone-first strategy.

WhatsApp preferred for African markets.

Email remains available for email-centric markets.

No reachable channel results in failure.

Current Scope

Production WhatsApp Business integration is not required.

No delivery success may be simulated.

Failures must be recorded honestly.

7. Seller Claim

Seller receives invitation.

Seller accesses claim portal.

Seller may:

claim ownership

decline

ignore invitation

Claim establishes ownership intent.

8. Claim Expiry

Invitation validity:

7 days

After expiration:

claim token expires

acquisition expires

draft inventory expires

Expired acquisitions cannot be converted.

9. Ownership Attestation

Seller confirms ownership of:

identity

phone number

marketplace listing

Ownership attestation is required before seller conversion.

10. Render Seller Conversion

After successful claim and attestation:

WhispeRM converts the seller into Render.

Outputs:

Render Seller record

Render Seller ID

Requirements:

claimed acquisition

ownership attestation

non-expired acquisition

No TrustLayer verification, TrustScore, verification level, or TrustLayer workflow is required or consulted.

11. Render Inventory Conversion

After seller conversion:

Draft Inventory converts into Render inventory.

Outputs:

Render Inventory record

Render Inventory ID

Requirements:

successful seller conversion

claimed inventory

non-expired acquisition

The captured marketplace snapshot remains authoritative.

No marketplace re-scraping occurs.

12. Marketplace Completion

Completion occurs only after:

Seller Conversion succeeds

Inventory Conversion succeeds

Completion actions:

Acquisition status becomes CONVERTED

Draft Inventory status becomes CONVERTED

Deal advances to Converted stage

Audit event recorded

Conversion Requirements

The following sequence is mandatory:

Capture→ Contact Match→ Deal→ Activity→ Draft Inventory→ Invitation→ Claim→ Ownership Attestation→ Render Seller Conversion→ Render Inventory Conversion→ Acquisition Completion

Skipping steps is not permitted.

No TrustLayer step exists anywhere in the conversion sequence.

TrustLayer Relationship

TrustLayer has zero role before conversion.

Seller Acquisition must function entirely without TrustLayer.

Seller creation and inventory creation occur independently of TrustLayer.

Only after seller and inventory conversion are complete may a Render seller optionally engage with TrustLayer services.

Examples of post-conversion services include:

Verification Level 2+

TrustScore

Enhanced trust signals

These services are outside the Seller Acquisition workflow.

Ownership Boundaries

WhispeRM

Owns:

acquisition workflows

captures

invitations

claims

draft inventory

conversion orchestration

Render

Owns:

sellers

inventory

marketplace experience

TrustLayer

Owns:

identity verification

trust scoring

reputation services

verification levels

TrustLayer ownership begins only after a seller has been converted into Render.

Current Implementation Status

Implemented:

Capture

Contact Matching

Deal Creation

Activity Creation

Draft Inventory

Seller Invitation

Claim Portal

Claim Lifecycle

Ownership Attestation

Render Seller Conversion

Render Inventory Conversion

Marketplace Completion

Seller Acquisition v1.0 is operational.

What Next

Planned enhancements include:

Production WhatsApp Business integration

Automated invitation delivery tracking

Expanded marketplace capture sources

Improved seller matching and deduplication

Enhanced acquisition analytics and funnel reporting

Bulk seller acquisition workflows

Seller self-service onboarding improvements

Operational monitoring and alerting for acquisition pipelines

These enhancements build on the existing Seller Acquisition v1.0 foundation while preserving the ownership boundaries between WhispeRM, Render, and TrustLayer.
