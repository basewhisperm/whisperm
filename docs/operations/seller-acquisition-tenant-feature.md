# Seller Acquisition tenant feature operations

`SELLER_ACQUISITION` controls the authenticated Marketplace Sellers add-on for a tenant. When enabled, the tenant sees the single **Marketplace Sellers** navigation entry and can access authenticated Marketplace Sellers app/API routes. When disabled, Marketplace Sellers is hidden and authenticated routes fail closed.

Public seller claim-token routes are intentionally not gated by authenticated add-on navigation visibility. Sellers who already received a claim link must be able to preview and accept the claim through the public claim-token flow according to the existing route architecture.

## List feature state

```sh
pnpm tenant-feature list --tenant acme
```

The tenant selector can be an exact tenant id, slug, or name. If no tenant matches, or more than one tenant matches, the command exits with a clear error instead of guessing.

## Enable Marketplace Sellers

```sh
pnpm tenant-feature enable --tenant acme --feature SELLER_ACQUISITION
```

Enable is idempotent: it creates the tenant feature row when missing, sets `enabled=true` when present but disabled, and relies on the `(tenantId, featureKey)` uniqueness constraint to avoid duplicate records.

## Disable Marketplace Sellers

```sh
pnpm tenant-feature disable --tenant acme --feature SELLER_ACQUISITION
```

Disable is idempotent: it sets `enabled=false` without deleting the tenant feature row.

## Expected product behavior

- Enabled tenants see **Marketplace Sellers** as the only Seller Acquisition add-on nav item.
- Disabled tenants do not see **Marketplace Sellers**.
- **Seller Capture** is not shown as a separate nav item.
- Core CRM navigation remains present in both states.
- Public claim-token routes remain reachable independently of authenticated tenant add-on visibility.

## Automatic discovery operations

- `Run Automatic Discovery` executes synchronously through the campaign runtime route and the JIJI public-search provider in the web deployment.
- The provider uses a fixed `https://jiji.com.gh` origin, a bounded campaign execution limit (maximum 500), and a 15-second request timeout.
- Manual URL import remains available separately for recovery or curated sourcing.
- A failed provider request produces a failed runtime execution and a non-2xx API response. Operators should inspect the execution error code before retrying; rate limits and transient upstream failures are retryable, while unsupported source configuration is not.