# Runtime Surface (ST1-013M)

This document is the canonical map of WhispeRM's asynchronous marketplace acquisition
execution: capture → campaign assignment → qualification → invitation → retry → claim →
conversion. It exists to answer, for any transition in that pipeline: which code owns it, where
its durable state lives, whether it is synchronous or queued, what its idempotency key is, and
what happens when it fails.

If you change ownership of a transition, update this file in the same change.

See also `docs/runtime/status-vocabulary.md` for the normalized status names each entity uses.

---

## 1. Canonical runtime decision

**QueueJob (Prisma-backed, Postgres) is the canonical durable queue.** `apps/worker` polls it
directly; there is no BullMQ/Redis/SQS anywhere in this repo.

Before this slice, the worker process (`apps/worker/src/index.ts`) constructed
`InMemoryQueueRuntime` — a `Map`/`Set`-backed bookkeeping object that satisfied the
`QueueRuntimePort` interface (`register`/`startWorker`/`stopWorker`/`deadLetter`) but never
polled anything. The process booted, logged "worker started", and then did nothing but respond
to SIGINT/SIGTERM — a loud warning log documented this ("no external queue is polled or consumed
by this process"). Meanwhile 5 call sites wrote `QueueJob` rows (3 API routes'
`CampaignRuntimeInvitationQueue.enqueueInvitation`, plus the claim-lifecycle and growth-loop
schedulers) and **zero** call sites ever read one back.

This slice replaces that bootstrap with `PrismaQueueRuntime` +
`runDurableQueuePollLoop`/`claimAndProcessOneDurableQueueJob`
(`apps/worker/src/durable-queue-runtime.ts`), which actually claims, dispatches, and persists the
outcome of every row in `QueueJob` for the queues/job types `apps/worker` registers.

**Why QueueJob over introducing BullMQ/Redis:**
- `QueueJob`/`DeadLetterJob`/`ExecutionLease`/`DistributedLock` already exist in
  `prisma/schema.prisma` with the exact fields a durable job lifecycle needs (state, attempts,
  idempotency key, lock, timestamps) — no new infrastructure, no new migration.
- `packages/worker-runtime` already implements the job/lease/retry-decision contract layer
  (`JobContract`, `computeRetryDecision`, `executeReplaySafeJob`) against this exact shape.
- Introducing Redis would add a new external dependency, a new failure mode (a second thing that
  can be down), and a second copy of retry/backoff logic to keep in sync with the Postgres-backed
  one — the constraint "do not create another runtime abstraction unless replacing/removing an
  old one" points at consolidating on what's already there, not adding a third option.
- The existing golden-path invitation dispatch (`CampaignRuntimeInvitationExecutor`, ST-003) is
  intentionally synchronous and does not depend on any queue at all; QueueJob is only needed for
  the genuinely asynchronous slice of the pipeline (scheduled reminders, retry backoff, growth
  loop evaluation) — a use case Postgres polling handles fine at WhispeRM's scale.

## 2. Synchronous vs. asynchronous flows

| Flow | Nature | Why |
|---|---|---|
| Marketplace capture | Synchronous | `POST /captures` runs `MarketplaceAcquisitionCaptureService.capture` inline and returns the result in the same request. |
| Campaign assignment | Synchronous | Runs inline immediately after capture, in the same request (see §5 for failure handling). |
| Qualification | Synchronous | `MarketplaceQualificationExecutionService` runs inline as part of capture/discovery completion. |
| Invitation send (golden path) | Synchronous | `CampaignRuntimeService.executeInvitation` calls `CampaignRuntimeInvitationExecutor.sendInvitation` inline (ST-003) when an executor is configured — which it always is in production (`createSellerInvitationExecutor`). The invitation completes or fails within the request. |
| Invitation retry (manual) | Synchronous | `POST .../retry` calls `retryInvitationExecution`, which also dispatches inline via the executor when configured. |
| Invitation retry (automatic backoff) | **Asynchronous** | `recordInvitationResult` schedules a `marketplace.invite.send` QueueJob (5m/30m/2h backoff, `CS-007`) when a delivery attempt fails retryably. This is the one invitation path genuinely driven by the durable queue. |
| Claim reminders (DAY_3/DAY_6) & expiry | **Asynchronous** | Scheduled ahead of time via `marketplace.claim.reminder`/`marketplace.claim.expire` QueueJob rows with `availableAt` set to the future send time. |
| Growth loop evaluation | **Asynchronous** (when queued) or synchronous (when no queue configured) — `CampaignRuntimeService.evaluateGrowthLoop` enqueues `marketplace.growth.loop.evaluate` if `growthLoopQueue` is wired, else computes inline. |
| Scheduled campaign execution | **Asynchronous**, but dead in production | `runDueScheduledCampaigns` only runs from a `scheduler.tick` QueueJob; nothing in this repo enqueues one (no cron producer exists). Left as-is; not part of this slice's scope to add a scheduler producer, since that would be a new feature, not a reliability fix. |

## 3. Runtime ownership map

| Flow | Entry Point | Owner (service) | Durable State | Queue Job | Idempotency Key | Failure State |
|---|---|---|---|---|---|---|
| Marketplace capture | `POST /api/marketplace-acquisition/captures` | `MarketplaceAcquisitionCaptureService.capture` (`packages/services/src/index.ts`) | `MarketplaceCapture` | none (synchronous) | `tenantId + listingUrl` (also `externalId` when present) — unique constraint on `MarketplaceCapture` | Request fails with a `ServiceError`; no partial capture row is left behind. |
| Campaign assignment | Same request, immediately after capture, in `captures/route.ts` | `SellerAcquisitionCampaignService.addSeller` → `PrismaSellerAcquisitionCampaignRepository` | `SellerAcquisitionCampaignMember` | none (synchronous) | `tenantId + campaignId + marketplaceCaptureId` — `@@unique([tenantId, campaignId, marketplaceCaptureId])` on the model | `campaignAssignment: { status: "FAILED", error }` in the response + `MARKETPLACE_CAPTURE_CAMPAIGN_ASSIGNMENT_FAILED` audit log entry (see §5). Capture itself still succeeds. |
| Invitation send (golden path) | `CampaignRuntimeService.executeInvitation` | `CampaignRuntimeService` → `CampaignRuntimeInvitationExecutor` (`createSellerInvitationExecutor`) | `CampaignRuntimeExecution`, `MarketplaceSellerInvitation` | none when executor configured; `marketplace.invite` / `marketplace.invite.send` as a fallback | `tenantId:campaignId:opportunityId` execution create is not itself deduped — see "duplicate invitation" note below; provider send is guarded by `MarketplaceSellerInvitation` row + provider idempotency where the provider adapter supports it | `CampaignRuntimeExecution.status = FAILED`, `metrics.invitationExecutionState = DEAD_LETTERED` after retries exhausted. |
| Invitation retry (automatic) | `CampaignRuntimeService.recordInvitationResult` | `CampaignRuntimeService` → `CampaignRuntimeInvitationQueue` (`createInvitationRuntimeJobQueue`, `apps/web/src/lib/marketplace-acquisition/runtime-job-queue.ts`) | `QueueJob` (`marketplace.invite` / `marketplace.invite.send`) | `marketplace.invite.send` | `campaign-runtime:{tenantId}:{executionId}` | `QueueJobState.DEAD_LETTERED` + `DeadLetterJob` row after `maxAttempts`. |
| Invitation retry (manual) | `POST .../campaigns/{campaignId}/runtime/executions/{executionId}/retry` | `CampaignRuntimeService.retryInvitationExecution` | `CampaignRuntimeExecution` | none when executor configured; `marketplace.invite.send` fallback via `createManualRetryInvitationRuntimeJobQueue` | `campaign-runtime:{tenantId}:{executionId}:manual-retry:{timestamp}` (fallback path only) | Response `{ ok: false, error }`, execution `status = FAILED`. |
| Claim reminder scheduling | `MarketplaceClaimLifecycleService.scheduleClaimLifecycle` | `apps/worker`'s `createClaimLifecycleScheduler` | `QueueJob` (`marketplace.claim.lifecycle`) | `marketplace.claim.reminder` / `marketplace.claim.expire` / `marketplace.claim.intelligence` | `job.dedupeKey` (per invitation + reminder type) | `QueueJobState.DEAD_LETTERED` + `DeadLetterJob` row. |
| Claim reminder / expiry execution | Worker consumer, `createClaimLifecycleHandler` | `MarketplaceClaimLifecycleService` | `MarketplaceClaimToken` | (consumes the above) | same as above | Handler throws a retryable `WorkerRuntimeError`; consumer applies retry/dead-letter per §4. |
| Growth loop evaluation | `CampaignRuntimeService.evaluateGrowthLoop` | `apps/worker`'s `createGrowthLoopScheduler` | `QueueJob` (`marketplace.growth.loop`) | `marketplace.growth.loop.evaluate` | `{tenantId}:{campaignId}` | `QueueJobState.DEAD_LETTERED` + `DeadLetterJob` row. Previously wrote an invalid `state: "PENDING"` (not a member of `QueueJobState`) that would have failed at the database the first time this path was actually exercised — fixed to `WAITING` in this slice. |
| Render/inventory conversion retry | `RenderConversionRetryService` | `apps/worker`'s `createRenderConversionRetryHandler` | `RenderConversion` | `render.conversion.retry` | `renderConversionId` | Handler-specific; see `render-conversion-retry.ts`. |

## 4. Canonical job lifecycle

`QueueJobState` (`prisma/schema.prisma`) is the one job-lifecycle enum in the system:

```
WAITING → ACTIVE → COMPLETED
WAITING → ACTIVE → RETRY_SCHEDULED → ACTIVE → ... → COMPLETED | DEAD_LETTERED
WAITING | DELAYED | RETRY_SCHEDULED → CANCELLED
```

- **WAITING** — enqueued, `availableAt <= now`, claimable.
- **DELAYED** — enqueued with a future `availableAt` (used by the claim-lifecycle scheduler for
  reminders); becomes claimable once `availableAt` passes. Treated identically to WAITING by the
  consumer's claim query.
- **ACTIVE** — claimed by a worker; `lockedUntil` set. A row stuck in `ACTIVE` past `lockedUntil`
  (a crashed worker) is reclaimed by the next `claimNext` call exactly like a `WAITING` row.
- **COMPLETED** — terminal success (`processJob` returned `SUCCEEDED` or `DUPLICATE_SKIPPED`).
- **RETRY_SCHEDULED** — a retryable failure; `availableAt` moved forward per
  `computeRetryDecision`'s backoff, `attemptsMade` already incremented at claim time.
- **DEAD_LETTERED** — terminal failure: either a non-retryable error code, or `attemptsMade >=
  maxAttempts`. A `DeadLetterJob` row is written with the reason and last error.
- **FAILED** — reserved for callers using `RuntimeJobService.failRuntimeJob` directly (outside the
  full `WorkerApplication`/`JobContract` path); not currently reached by the worker's own durable
  consumer, which always resolves a failure to `RETRY_SCHEDULED` or `DEAD_LETTERED`.
- **CANCELLED** — reserved for operator-initiated cancellation (`RuntimeJobService.cancelRuntimeJob`);
  not currently triggered by any product flow.

### Canonical helpers (`packages/services/src/runtime-job-service.ts`)

```
enqueueRuntimeJob(context, input)   // validates payload against runtime-job-contracts.ts, idempotent create
claimNextRuntimeJob(input)          // delegates to QueueJobRepository.claimNext
completeRuntimeJob(context, id)     // WAITING/RETRY_SCHEDULED/stale-ACTIVE -> ACTIVE -> COMPLETED
failRuntimeJob(context, input)      // computeRetryDecision -> RETRY_SCHEDULED or DEAD_LETTERED + DeadLetterJob
retryRuntimeJob(context, id, input) // force a job back to RETRY_SCHEDULED
cancelRuntimeJob(context, id)       // WAITING/DELAYED/RETRY_SCHEDULED -> CANCELLED
```

Route handlers and services must call these (or the durable worker consumer, which uses the same
`QueueJobRepository` underneath) instead of touching `prisma.queueJob.*` directly. Before this
slice, 5 call sites each hand-rolled their own `prisma.queueJob.create`/`upsert`, including three
near-identical copies of the same object literal in `apps/web` API routes.

**Why the worker's own durable consumer doesn't call `failRuntimeJob`:** `WorkerApplication.processJob`
(via `worker-runtime`'s `computeRetryDecision`, using the job's own `retryPolicy`) already makes
the retry-vs-terminal decision once, and `PrismaQueueRuntime.deadLetter()` persists that verdict.
Calling `failRuntimeJob` as well would run `computeRetryDecision` a second time against a
possibly-different default policy — a second, divergent decision engine. `failRuntimeJob` is kept
as the primitive for callers that operate on `QueueJob` rows *outside* the full
`WorkerApplication`/`JobContract` path (kept for completeness and covered by tests), not invoked
by the hot path.

### Durable properties already on `QueueJob` (no migration needed)

| Required property | Field |
|---|---|
| Idempotency key | `jobKey` (unique with `tenantId`, `queueName`) |
| Job type | `jobName` |
| Payload schema validation | Enforced by `RuntimeJobService.enqueueRuntimeJob` at enqueue time (`runtime-job-contracts.ts`) and again by the worker handler at execution time |
| Attempt count | `attemptsMade` |
| Max attempts | `maxAttempts` |
| Last error | `lastError` (JSON) |
| Created / updated at | `createdAt` / `updatedAt` |
| Available at / run after | `availableAt` |
| Completed at / failed at | Derived from `updatedAt` + terminal `state` — no separate columns were added, since `state` plus `updatedAt` already answers "when did this reach its terminal state" without a redundant pair of nullable timestamp columns. |

## 5. Capture → campaign assignment integrity (the "Acceptable option")

**Decision: capture and campaign assignment are not transactional.** Capture succeeds
independently even if the requested campaign assignment fails, and the response makes that
explicit instead of staying silent about it:

```json
{
  "ok": true,
  "data": { "captureId": "...", "...": "..." },
  "campaignAssignment": { "status": "FAILED", "error": { "code": "PERSISTENCE_NOT_FOUND", "message": "..." } }
}
```

`campaignAssignment.status` is one of `COMPLETED`, `ALREADY_ASSIGNED` (idempotent duplicate — the
unique constraint on `[tenantId, campaignId, marketplaceCaptureId]` was hit, not a real failure),
or `FAILED`. The field is omitted entirely when the request didn't ask for campaign assignment.

**Why not transactional:** a capture is a durable, independently valuable record (a discovered
seller) even if the campaign it was meant to join no longer exists or errors out — the alternative
(rolling back / failing the whole capture because campaign assignment failed) would silently drop
a captured seller, which is worse than a capture with a visibly-failed assignment. This mirrors
the existing behavior of every other "capture succeeds independently" invariant in this codebase
(e.g. capture-time CRM conversion is similarly best-effort and explicit about its status).

**What changed from before this slice:** the assignment failure used to be swallowed by a bare
`catch {}` with a comment acknowledging it ("Non-fatal: capture succeeded, campaign assignment
failed silently") and left no trace anywhere. Now:
1. The response includes the explicit `campaignAssignment` field above.
2. A genuine failure (not the idempotent-duplicate case) writes a
   `MARKETPLACE_CAPTURE_CAMPAIGN_ASSIGNMENT_FAILED` audit log entry via `AuditLogRepository`,
   with `targetId` = the capture id and `metadata.campaignId`/`errorCode`/`errorMessage` — durable,
   queryable, and tied to the correlation id of the request.
3. Duplicate assignment attempts (retrying the same capture+campaign pair) are recognized as
   `ALREADY_ASSIGNED`, not reported or audited as a failure.

Tests: `apps/web/test/marketplace-capture-route.test.js` — "campaign assignment success is
reported explicitly", "campaign assignment failure is visible in the response and durably
audited", "duplicate campaign assignment is idempotent, not reported as a failure".

## 6. Invitation channel consolidation

**Canonical field: `metrics.selectedChannel`** on `CampaignRuntimeExecution`, set once at
dispatch time by `buildInvitationOptimizationStrategy` (`packages/services/src/campaign-runtime.ts`)
and never overwritten afterward. `metrics.channel` is a *second*, execution-outcome field set only
once a send attempt actually completes (success or failure), by `recordInvitationResult`.

**Fallback policy:** any code that needs "the channel this invitation is using/used" must read
`metrics.channel ?? metrics.selectedChannel` — `channel` is only meaningful after a send attempt,
`selectedChannel` is authoritative from the moment of dispatch. This is already how
`invitation-execution-response.ts` (API response shaping) and `acquisition-runtime-health.ts`
(provider-health/channel-usage reporting) read it.

**Bug fixed in this slice:** `CampaignRuntimeService.retryInvitationExecution`
(`packages/services/src/campaign-runtime.ts`) read `metrics.channel` **only**, with no fallback.
An execution that never reached `recordInvitationResult` — e.g. it was left `RUNNING`/`DISPATCHED`
because the async worker path was never drained (the very defect this slice fixes) — had
`metrics.channel === undefined` even though `metrics.selectedChannel` correctly held the seller's
actual chosen channel (e.g. `SMS` or `EMAIL`). Retry silently fell back to `WHATSAPP` instead of
the seller's real channel. Fixed to use the same `metrics.channel ?? metrics.selectedChannel`
fallback as the other two call sites, with `WHATSAPP` only as the absolute last resort when
neither field is present.

Tests: `packages/services/test/campaign-runtime.test.mjs` — "retry falls back to
metrics.selectedChannel when metrics.channel is missing", "retry only falls back to WhatsApp when
neither field is present".

## 7. Idempotency enforcement

| Operation | Idempotency key | Enforced by |
|---|---|---|
| Capture | `tenantId + listingUrl` (`externalId` when present) | `MarketplaceCapture` unique constraints |
| Campaign assignment | `tenantId + campaignId + marketplaceCaptureId` | `SellerAcquisitionCampaignMember.@@unique([tenantId, campaignId, marketplaceCaptureId])` |
| Invitation queue enqueue | `tenantId + queueName + jobKey` (`campaign-runtime:{tenantId}:{executionId}`) | `QueueJob.@@unique([tenantId, queueName, jobKey])`, enforced by `PrismaQueueJobRepository.enqueue` (duplicate returns the existing row instead of erroring or duplicating) |
| Claim reminder scheduling | `job.dedupeKey` | Same `QueueJob` unique constraint, via `queueJob.upsert` |
| Growth loop evaluation | `{tenantId}:{campaignId}` | Same, via `queueJob.upsert` |
| Worker job claim | `(tenantId, id)` + state precondition | `PrismaQueueJobRepository.claimNext`'s conditional `updateMany` — see §8 |
| Provider send | Delegated to the provider adapter where it supports idempotency keys; not re-implemented here | `packages/provider-adapters` |

## 8. Durable consumer behavior (worker restart / duplicate worker / stale lock)

`PrismaQueueJobRepository.claimNext` (`packages/repositories/src/queue-job.ts`) is the only place
a job transitions to `ACTIVE`. It selects candidate rows, then attempts a conditional
`updateMany` per candidate:

```sql
UPDATE "QueueJob"
SET state = 'ACTIVE', "lockedUntil" = ..., "attemptsMade" = "attemptsMade" + 1
WHERE id = $1 AND tenantId = $2
  AND (state IN ('WAITING','RETRY_SCHEDULED') OR (state = 'ACTIVE' AND "lockedUntil" < now()))
```

Two workers racing the same row serialize at the database row lock; the loser's `WHERE` no longer
matches once the winner's transaction commits (`state` moved to `ACTIVE`, or `lockedUntil` moved
into the future), so `updateMany`'s `count` is `0` for the loser — **no double-execution.**

A worker that crashes mid-job leaves the row `ACTIVE` with a `lockedUntil` that eventually passes;
the next `claimNext` call (from the same process after restart, or a different one) reclaims it
via the second branch of that `WHERE` — **no lost job.**

## 9. Retriable vs. terminal failures

| Failure | Retriable? | Where decided |
|---|---|---|
| Payload fails `runtime-job-contracts.ts` schema at enqueue time | Terminal — the enqueue call itself throws; no `QueueJob` row is ever created | `RuntimeJobService.enqueueRuntimeJob` |
| Payload fails the handler's own schema at execution time (defense in depth) | Terminal by default (`WORKER_RUNTIME_VALIDATION_FAILED` is in the default durable retry policy's `nonRetryableErrorCodes`) | `defaultDurableRetryPolicy` (`apps/worker/src/durable-queue-runtime.ts`) |
| Tenant isolation violation | Terminal | Same default policy |
| Provider/service unavailable, network errors, other `WorkerRuntimeError`s | Retriable up to `QueueJob.maxAttempts`, exponential backoff (60s base, 1h cap, ×2 multiplier) | `computeRetryDecision` (`@whisperm/worker-runtime`) |
| `maxAttempts` exhausted | Terminal — `DEAD_LETTERED` + `DeadLetterJob` row | `computeRetryDecision` / `PrismaQueueRuntime.deadLetter` |
| Campaign assignment failure on capture | Not retried automatically — surfaced in the response + audited (§5); the caller can re-submit the assignment, which is idempotent | `captures/route.ts` |

Known limitation carried over from the pre-existing `worker-runtime` error model: `WorkerRuntimeError`
only has 7 coarse error codes, and `WORKER_RUNTIME_VALIDATION_FAILED` is used both for "a
dependency isn't configured" (semantically transient) and "the payload/state is invalid"
(semantically terminal). This slice does not redesign that taxonomy (out of scope — a much larger
change with its own risk); the default durable retry policy treats that code as terminal, which is
the safer default for a code whose two meanings disagree, and matches the convention already
established in `apps/worker/test/worker.test.js`'s own default job fixture.
