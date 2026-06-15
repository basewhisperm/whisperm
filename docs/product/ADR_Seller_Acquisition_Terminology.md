# ADR — Seller Acquisition Terminology

## Decision

Use **Seller Acquisition** as the business and user-facing product term.

Keep existing technical route, package, database, and permission identifiers using `marketplace-acquisition` / `marketplace_acquisition` unless a future migration explicitly renames them.

## Rationale

Seller Acquisition describes the business outcome: captured sellers are invited, claimed, verified, and converted into Render sellers with draft inventory.

Marketplace Acquisition remains a legacy/internal implementation name for compatibility with existing routes, tests, permissions, and integrations.

## Mapping

| Layer | Preferred term |
|---|---|
| Product/UI | Seller Acquisition |
| Docs | Seller Acquisition |
| Existing URLs | `/marketplace-acquisition/...` |
| Existing pipeline key | `marketplace_acquisition` |
| Existing permissions | `marketplace_acquisition.*` |

## Non-goals

This ADR does not rename routes, Prisma models, database fields, permission constants, package paths, or API contracts.
