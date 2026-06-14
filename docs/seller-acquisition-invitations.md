# Seller Acquisition Invitations

Seller Acquisition invitations are cellphone-first, with WhatsApp as the preferred channel for African markets and email as a fallback/alternate channel for markets where email is primary.

The default channel order is configurable business logic rather than Africa-specific hard-coding:

1. Phone + WhatsApp enabled: send WhatsApp.
2. Phone + WhatsApp unavailable/disabled: send SMS.
3. Email only: send email.
4. Phone and email: prefer cellphone channels first; email remains available as an explicit preferred channel or future fallback.
5. No phone and no email: fail with `Seller has no reachable invitation channel.`

A production WhatsApp Business provider is intentionally out of scope for this slice. Until one is configured, the invitation engine does not fake a successful WhatsApp delivery; it records failure or falls back to SMS when SMS is configured.
