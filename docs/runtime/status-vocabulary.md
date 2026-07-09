# Status Vocabulary (ST1-013M)

Normalized status names across every entity in the marketplace acquisition runtime. If you add a
new status value anywhere in this pipeline, add it here in the same change — this table is what
prevents UI/runtime drift (a label the UI shows that the runtime never actually sets, or a runtime
state nothing in the UI knows how to render).

See `docs/runtime/runtime-surface.md` for how these entities relate to each other and to the
QueueJob durable queue.

## MarketplaceCapture.status

| Status | Meaning | Set By | Next Allowed States |
|---|---|---|---|
| `CAPTURED` | Seller listing captured, not yet invited | `MarketplaceAcquisitionCaptureService.capture` | `INVITED`, `EXPIRED` |
| `INVITED` | An invitation has been dispatched for this capture | `CampaignRuntimeService` / `SellerInvitationService` on successful send | `CLAIM_STARTED`, `EXPIRED` |
| `CLAIM_STARTED` | The seller opened/started the claim flow | `SellerClaimPortalService` | `CLAIMED`, `EXPIRED` |
| `CLAIMED` | The seller completed the claim | `SellerClaimPortalService` / `MarketplaceClaimLifecycleService` | `CONVERTED` |
| `CONVERTED` | The claim was converted (CRM deal / Render inventory) | `MarketplaceCaptureCompletionService`, `RenderInventoryConversionService` | (terminal) |
| `EXPIRED` | Claim window expired without action | `MarketplaceClaimLifecycleService.expireClaimInvitation` | (terminal) |

## SellerAcquisitionCampaignMember.status ("CampaignSeller")

| Status | Meaning | Set By | Next Allowed States |
|---|---|---|---|
| `ADDED` | Capture assigned to a campaign | `SellerAcquisitionCampaignService.addSeller` | `QUALIFIED`, `REMOVED` |
| `QUALIFIED` | Passed qualification | `MarketplaceQualificationExecutionService` | `INVITED`, `REMOVED` |
| `INVITED` | Invitation dispatched for this membership | `CampaignRuntimeService` | `CLAIMED`, `REMOVED` |
| `CLAIMED` | Seller claimed | `MarketplaceClaimLifecycleService` | `CONVERTED`, `REMOVED` |
| `CONVERTED` | Converted to CRM/inventory | `MarketplaceCaptureCompletionService` | `COMPLETED` |
| `COMPLETED` | Full lifecycle finished for this member | Campaign-level rollup logic | (terminal) |
| `REMOVED` | Manually removed from the campaign (`removedAt` set) | `SellerAcquisitionCampaignService.removeSeller` | (terminal) |

**Campaign assignment API response status** (not persisted — a response-shaping field, see
`runtime-surface.md` §5): `COMPLETED` (member row created), `ALREADY_ASSIGNED` (idempotent
duplicate — the unique constraint on `[tenantId, campaignId, marketplaceCaptureId]` was hit),
`FAILED` (durable-audited failure; capture itself still succeeds).

## MarketplaceSellerInvitation.status

| Status | Meaning | Set By | Next Allowed States |
|---|---|---|---|
| `PENDING` | Invitation row created, not yet sent | `SellerInvitationService` at creation | `SENT`, `FAILED` |
| `SENT` | Delivered by the provider | `recordInvitationResult` / provider adapter success | `OPENED`, `EXPIRED` |
| `FAILED` | Delivery attempt failed | `recordInvitationResult` on provider error | `SENT` (on manual/automatic retry), `EXPIRED` |
| `OPENED` | Seller opened the invite link | Claim portal tracking | `EXPIRED` (claim flow tracked separately via `MarketplaceClaimToken`) |
| `EXPIRED` | Invitation link expired unused | `MarketplaceClaimLifecycleService.expireClaimInvitation` | (terminal) |

## MarketplaceClaimToken.status

| Status | Meaning | Set By | Next Allowed States |
|---|---|---|---|
| `PENDING` | Token created, not yet sent | `MarketplaceClaimLifecycleService` | `SENT` |
| `SENT` | Claim link delivered | `MarketplaceClaimLifecycleService.sendClaimReminder` / initial send | `OPENED`, `EXPIRED`, `CLAIMED` |
| `FAILED` | Delivery attempt failed | Notification port error | `SENT` (retry), `EXPIRED` |
| `OPENED` | Seller opened the claim link | Claim portal | `CLAIMED`, `EXPIRED` |
| `EXPIRED` | Claim window elapsed | `expireClaimInvitation` | (terminal) |
| `CLAIMED` | Seller completed the claim | `SellerClaimPortalService` | (terminal) |
| `ABANDONED` | Seller started but did not finish the claim flow | `evaluateClaimIntelligence` / recovery logic | `CLAIMED` (recovered), `EXPIRED` |

## CampaignRuntimeExecution.status

| Status | Meaning | Set By | Next Allowed States |
|---|---|---|---|
| `QUEUED` | Execution created, dispatch not yet attempted (or suppressed) | `CampaignRuntimeService.executeInvitation` | `RUNNING`, `COMPLETED` (suppressed) |
| `RUNNING` | Dispatch in flight (synchronous executor) or a retry is scheduled | `dispatchInvitationInline` / `recordInvitationResult` (retryable failure) | `COMPLETED`, `FAILED` |
| `COMPLETED` | Delivered, or suppressed by optimization strategy | `recordInvitationResult` (delivered) / `executeInvitation` (suppressed) | (terminal) |
| `FAILED` | Delivery failed and no retry remains | `recordInvitationResult` (non-retryable or retries exhausted) | `RUNNING` (manual retry) |
| `CANCELLED` | Not currently set by any product flow | — | (terminal) |

### `CampaignRuntimeExecution.metrics.invitationExecutionState` (informal sub-state, not a DB enum)

| Value | Meaning |
|---|---|
| `PENDING` | Execution created, strategy computed, dispatch not yet started |
| `SUPPRESSED` | Optimization strategy decided not to send (e.g. cooldown) |
| `DISPATCHED` | Send attempt in flight (synchronous) or handed to the queue |
| `DELIVERED` | Provider confirmed delivery |
| `FAILED` | Last attempt failed, more retries remain |
| `RETRY_SCHEDULED` | A retry has been enqueued (`QueueJob`) — **only meaningful once the durable consumer is actually draining `QueueJob`**, which this slice makes true; before this slice this state was reachable but the retry behind it would never fire |
| `DEAD_LETTERED` | Retries exhausted; matches `CampaignRuntimeExecution.status = FAILED` |

**Canonical channel field:** `metrics.selectedChannel` (set once at dispatch) is authoritative for
"what channel is this invitation using"; `metrics.channel` (set once a send attempt completes) is
authoritative for "what channel did this invitation actually use". Any reader needing "the
channel" — UI, metrics, retry — must read `metrics.channel ?? metrics.selectedChannel`. See
`runtime-surface.md` §6.

## QueueJob.state (canonical durable job lifecycle)

| Status | Meaning | Set By | Next Allowed States |
|---|---|---|---|
| `WAITING` | Enqueued, claimable once `availableAt` passes | `RuntimeJobService.enqueueRuntimeJob` | `ACTIVE`, `CANCELLED` |
| `DELAYED` | Enqueued with a future `availableAt` (scheduled reminders) | `createClaimLifecycleScheduler` | `ACTIVE` (once due), `CANCELLED` |
| `ACTIVE` | Claimed by a worker, `lockedUntil` set | `PrismaQueueJobRepository.claimNext` | `COMPLETED`, `RETRY_SCHEDULED`, `DEAD_LETTERED` |
| `COMPLETED` | Handler succeeded (or was a duplicate, already-completed idempotency key) | `claimAndProcessOneDurableQueueJob` | (terminal) |
| `FAILED` | Reserved for `RuntimeJobService.failRuntimeJob` callers outside the full worker consumer path | `RuntimeJobService.failRuntimeJob` (not currently reached by the worker's own consumer) | `RETRY_SCHEDULED`, `DEAD_LETTERED` |
| `RETRY_SCHEDULED` | Retryable failure; `availableAt` moved forward per backoff | `computeRetryDecision` via `claimAndProcessOneDurableQueueJob` | `ACTIVE` (once due), `CANCELLED`, `DEAD_LETTERED` |
| `DEAD_LETTERED` | Terminal failure; `DeadLetterJob` row written | `PrismaQueueRuntime.deadLetter` | (terminal) |
| `CANCELLED` | Reserved for `RuntimeJobService.cancelRuntimeJob` (not currently triggered by any product flow) | `RuntimeJobService.cancelRuntimeJob` | (terminal) |

## Worker logs

Worker bootstrap logs `queueRuntime: "PrismaQueueRuntime"` at startup (previously
`"InMemoryQueueRuntime"` with a loud warning that no queue was consumed — see
`runtime-surface.md` §1). Per-job outcomes are logged as `durable queue job processed` with
`{ jobId, outcome }`, where `outcome` is one of `COMPLETED` | `RETRY_SCHEDULED` | `DEAD_LETTERED`
(a direct alias of the `QueueJob.state` values above, not a fourth vocabulary).

## API responses

- `POST /captures` → `campaignAssignment.status`: `COMPLETED` | `ALREADY_ASSIGNED` | `FAILED` (see above).
- `POST /captures/{id}/invite`, bulk-invite, and the manual retry endpoint → `status: "SENT" |
  "QUEUED"` in the success case (`"SENT"` when `CampaignRuntimeExecution.status === "COMPLETED"`,
  `"QUEUED"` otherwise), mirroring `CampaignRuntimeExecution.status` rather than introducing a
  fourth vocabulary for the same concept.

## UI labels

UI components reading invitation/execution status must read the same
`metrics.channel ?? metrics.selectedChannel` and `CampaignRuntimeExecution.status` /
`metrics.invitationExecutionState` fields documented above — not a separately-maintained set of
UI-only status strings. Where a UI label differs from the raw enum value (e.g. presenting
`DISPATCHED` as "Sending…"), that mapping lives in `apps/web/src/lib/marketplace-acquisition/*`
display-formatting helpers, and must only ever be a *display* transform of one of the values in
this document — never an independent status source.
