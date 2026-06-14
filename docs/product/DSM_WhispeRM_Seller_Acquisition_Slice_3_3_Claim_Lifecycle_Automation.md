# DSM WhispeRM Seller Acquisition Slice 3.3 — Claim Lifecycle Automation

## Lifecycle

Seller claim invitations use an exact 7-day claim window measured from the successful send/queue timestamp:

- **Day 0:** invitation is sent and lifecycle jobs are scheduled.
- **Day 3:** reminder #1 is sent if the invitation is still active.
- **Day 6:** final reminder is sent if the invitation is still active.
- **Day 7:** invitation expires if it has not been claimed or converted.

## Reminder behavior

Reminder jobs load the claim token by both `tenantId` and invitation ID, verify the related marketplace acquisition is still active, and send simple reminder copy:

- Day 3: “Reminder: claim your seller listing/inventory.”
- Day 6: “Final reminder: your claim link expires soon.”

Reminder jobs prefer the original successful invitation channel. If that channel fails, the notification runtime is expected to apply the Seller Invitation Engine fallback order.

## Expiration behavior

Expiration jobs are tenant-scoped and idempotent. Once `now >= expiresAt`, the lifecycle service:

1. Marks the claim token `EXPIRED` and records `expiredAt`.
2. Moves the marketplace acquisition capture to `EXPIRED`.
3. Marks the associated `DraftInventory` as `EXPIRED` when present and not already claimed or converted.
4. Records an audit event.

Records are never deleted as part of expiration.

## Channel priority

The lifecycle automation preserves the cellphone-first priority established by the Seller Invitation Engine:

1. WhatsApp
2. SMS
3. Email fallback

## Idempotency rules

- Day 3 reminders are not resent when `reminderDay3SentAt` is already populated.
- Day 6 reminders are not resent when `reminderDay6SentAt` is already populated.
- Already expired invitations are a no-op success.
- Claimed or converted acquisitions are not expired.
- Audit events are emitted only for state-changing lifecycle actions where avoidable.

## Out of scope

- Claim portal
- Ownership attestation
- Render conversion
- Analytics dashboard
- TrustLayer verification
- Full WhatsApp Business production integration unless a provider already exists

## Follow-up

Issue #144 implements the seller claim portal and claim acceptance flow. This slice only automates reminders and expiration for sent invitations.
