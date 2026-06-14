# DSM WhispeRM Seller Acquisition Slice 3.1 — Lifecycle Pipeline

## Business purpose

This slice completes the Seller Acquisition lifecycle foundation so marketplace seller opportunities can be counted, moved, and displayed consistently before invitation delivery, claim automation, and Render conversion work begins.

## Implemented stages

The Marketplace Acquisition pipeline seed creates exactly these stages in order:

1. Captured (`captured`)
2. Invited (`invited`)
3. Claim Started (`claim-started`)
4. Claimed (`claimed`)
5. Converted (`converted`)
6. Expired (`expired`)

## Allowed transitions

- Captured → Invited
- Invited → Claim Started
- Claim Started → Claimed
- Claimed → Converted
- Captured → Expired
- Invited → Expired
- Claim Started → Expired

Terminal stages (`Converted`, `Expired`) do not move backwards in this slice.

## Out of scope

- Seller invitation sending
- 7-day reminder automation
- Claim portal
- Claim token lifecycle implementation
- Render seller conversion
- Render inventory conversion
- TrustLayer verification
- Analytics platform work
- Bookmarklet redesign

## Files changed

- `prisma/pipeline-seed.mjs` for lifecycle stage seed data.
- `packages/types/src/marketplace-acquisition.ts` for acquisition status contract values.
- `packages/repositories/src/index.ts` and `packages/repositories/src/marketplace-acquisition.ts` for tenant-scoped capture lookup/update support.
- `packages/services/src/index.ts` for Marketplace Acquisition transition validation.
- `apps/web/src/app/api/marketplace-acquisition/deals/[dealId]/stage/route.ts` and marketplace dashboard summary files for six-stage recognition.
- Tests under `prisma/test`, `packages/services/test`, and `apps/web/test`.

## Validation commands

Run:

```bash
pnpm --filter @whisperm/types build
pnpm --filter @whisperm/repositories typecheck
pnpm --filter @whisperm/services typecheck
pnpm --filter @whisperm/api typecheck
pnpm --filter @whisperm/api test
pnpm typecheck
pnpm test
```

## Follow-up issues

- #142 Seller Invitation Engine
- #143 7-Day Claim Lifecycle Automation
- #144 Seller Claim Portal
- #146 Render Seller Conversion
- #147 Render Inventory Conversion
