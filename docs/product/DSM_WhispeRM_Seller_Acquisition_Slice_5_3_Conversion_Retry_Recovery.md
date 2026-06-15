# DSM WhispeRM Seller Acquisition Slice 5.3 — Conversion Retry & Recovery

## Purpose

This slice makes failed Render seller and inventory conversions durable, observable, and safely retryable. Retries operate on the existing `RenderConversion` record and preserve tenant scoping for every repository, worker, and API boundary.

## Retry Eligibility

A conversion can retry only when it is `FAILED` or `RETRYING`, has remaining attempts, is due (`nextAttemptAt` is empty or in the past), is a `SELLER` or `INVENTORY` conversion, and its marketplace acquisition is still claimed. Expired, fully converted, successful, dead-lettered, unsupported, or duplicate-success conversions are not retried.

## Statuses and Tracking

Supported statuses are `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED`, `RETRYING`, and `DEAD_LETTERED`. Retry metadata tracks `attemptCount`, `maxAttempts`, `nextAttemptAt`, `lastAttemptAt`, `failureReason`, `failureCode`, `deadLetteredAt`, and `completedAt`.

## Backoff Policy

Backoff is deterministic: attempt 1 waits 5 minutes, attempt 2 waits 30 minutes, and attempt 3 waits 2 hours. Tests use a fixed clock and no random jitter.

## Worker Job

The worker job type is `render.conversion.retry` with payload `{ tenantId, conversionId }`. The worker validates the job tenant matches the execution context and calls the retry service.

## Manual Retry API

Operators can call `POST /marketplace-acquisition/render-conversions/:id/retry`. The endpoint requires tenant context, an authenticated actor, and the marketplace acquisition conversion permission. Responses include conversion id, status, attempt count, and next attempt time without exposing provider secrets.

## Dead-Letter Behavior

When attempts are exhausted, or when a duplicate successful conversion already exists, the failed conversion is marked `DEAD_LETTERED`, `deadLetteredAt` is set, and no additional provider call is made.

## Idempotency Strategy

Seller retries use `render-seller:{tenantId}:{marketplaceCaptureId}:{contactId}`. Inventory retries use `render-inventory:{tenantId}:{draftInventoryId}`. The retry service checks for existing successful conversions before invoking a provider connector.

## Audit Events

The framework records `RENDER_CONVERSION_RETRY_SCHEDULED`, `RENDER_CONVERSION_RETRY_STARTED`, `RENDER_CONVERSION_RETRY_SUCCEEDED`, `RENDER_CONVERSION_RETRY_FAILED`, and `RENDER_CONVERSION_DEAD_LETTERED` with tenant-safe metadata.

## Out of Scope

This slice does not add dashboards, TrustLayer verification, payment/escrow, claim portal changes, invitation changes, marketplace re-scraping, or new conversion business logic beyond retry/recovery.

## Follow-up

Issue #149, Acquisition Analytics Platform, should consume these durable status and audit fields for reporting.
