# CS-007 — Reliable Invitation Delivery

Status: Active

## Constitutional alignment

- Runtime owns invitation execution state by extending `CampaignRuntimeService`.
- Workers execute provider delivery through the existing `marketplace.invite.send` path.
- Repositories persist retry state on existing campaign runtime execution metrics and seller invitation metadata.
- Providers remain behind existing invitation provider adapters; API routes only enqueue work.
- UI visualizes retry/dead-letter status in the existing acquisition workbench surface.
- No new queue, runtime, provider, or invitation architecture was introduced.

## Retry policy

Retryable invitation failures use deterministic backoff:

1. retry count 1: 5 minutes
2. retry count 2: 30 minutes
3. retry count 3+: 2 hours

The default maximum retry count is 3. When retry attempts are exhausted, or a failure is non-retryable, the runtime execution metrics mark `invitationExecutionState` as `DEAD_LETTERED`.

## Safe failure metadata

Runtime metrics record only safe operational metadata: retry counts, max retries, next retry time, last attempt time, retryability, failure code, and sanitized failure message. Raw provider responses and secrets are not stored.
