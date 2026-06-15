# DSM — Seller Acquisition Slice 8.1: Channel Preferences

## Status
Implemented.

## Decision
Seller Acquisition is WhatsApp-first for Africa and other cellphone-first markets.

Email remains supported as an optional channel for non-cellphone-first markets.

## Channel Contract
Supported invitation channels:

1. WHATSAPP
2. SMS
3. EMAIL

## Resolution Rules
- If a preferred channel is provided, the seller must have the required recipient field.
- EMAIL requires seller email.
- WHATSAPP and SMS require seller phone.
- If no preferred channel is provided and seller phone exists, default to WHATSAPP when WhatsApp is enabled.
- If WhatsApp is disabled, default to SMS.
- If seller phone is missing but seller email exists, default to EMAIL.
- If WhatsApp delivery is unavailable, fallback to SMS when SMS is configured and fallback is not disabled.

## Implementation References
- `packages/types/src/marketplace-acquisition.ts`
- `packages/services/src/index.ts`
- `packages/repositories/src/index.ts`

## Non-Goals
This slice does not add new WhatsApp/SMS/email provider integrations.

## Acceptance
- WHATSAPP, SMS, and EMAIL remain in the shared channel schema.
- WhatsApp-first default behavior is documented.
- SMS fallback behavior is documented.
- Email optional behavior is documented.
- Existing tests and typecheck pass.
