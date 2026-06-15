# DSM — WhispeRM Seller Acquisition Slice 6.2: Marketplace Capture Completion

## One-touch capture principle
A successful marketplace capture is a single operator action that persists the full seller acquisition foundation from the page snapshot: `MarketplaceCapture → Contact / Draft Seller abstraction → Acquisition Deal → DraftInventory`.

## Seller fields
The capture payload supports `sellerName`, `sellerProfileUrl`, `marketplaceIdentifier`, `phone`, `email`, and `location`. Phone and email are optional because marketplace pages may not expose them, but visible values must be preserved for cellphone-first invitations and email fallback.

## Inventory fields
The payload supports `title`, `description`, `images`, `price`, `currency`, `category`, `listingUrl`, `marketplaceSource`, and `marketplaceListingId`.

## Metadata fields
The payload supports `capturedAt`, `capturedBy`, tenant context from authenticated API context, `pageUrl`, `sourceMarketplace`, and `userAgent` when available.

## Extraction strategy
Bookmarklet extraction is conservative and snapshot-only. It uses layered detection in this order:
1. OpenGraph/meta tags.
2. JSON-LD/schema.org product and offer data.
3. Common DOM selectors for price, seller, category, image, and location signals.
4. Visible text heuristics for phone and email only when present on the page.
5. URL/hostname fallback for marketplace source and listing identifier.

The bookmarklet does not read cookies, local storage, session storage, credentials, full page HTML, or perform network calls other than handing off to WhispeRM intake.

## Duplicate behavior
Duplicate handling is tenant-scoped. Within the same tenant, capture reuses existing records when the same marketplace listing URL or marketplace listing identifier is observed. Draft inventory upsert also reuses an existing tenant-scoped marketplace listing record when available. No deduplication occurs across tenants.

## Performance rule
Capture should complete in under 10 seconds for normal pages. Extraction runs client-side, stores URL/text/image snapshots only, and never downloads marketplace images or re-scrapes the source marketplace after capture.

## Cellphone-first invitation readiness
Captured `phone` flows into the Contact abstraction and capture metadata so the existing cellphone-first invitation engine can prefer WhatsApp/SMS. Captured `email` is preserved as a fallback channel. This slice does not send invitations.

## Out of scope
- Invitation sending changes.
- Claim portal changes.
- Render conversion changes.
- Retry framework changes.
- Analytics changes.
- TrustLayer verification.
- Marketplace re-scraping after capture.
