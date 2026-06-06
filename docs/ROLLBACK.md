# WhispeRM — Rollback Plan

**Version:** 1.0 · June 2026
**Owner:** Engineering

---
## 1. Deployment rollback (Vercel)

If a production deployment causes errors:

1. Go to vercel.com → WhispeRM project → Deployments
2. Find the last known-good deployment
3. Click Promote to Production
4. Verify the dashboard loads
5. Notify the team

Vercel rollback takes effect in under 30 seconds.

---
## 2. Database migration rollback (Prisma)

WhispeRM uses additive-only migrations.
If a migration causes data issues:

1. Do not run further migrations
2. Roll back Vercel deployment first
3. Identify the bad migration in prisma/migrations/
4. Run inverse SQL manually on production DB
5. Mark rolled back: UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE migration_name = NAME;
6. Verify before re-enabling traffic

---
## 3. Environment variable rollback

1. Go to Vercel Settings → Environment Variables
2. Edit or delete the problematic variable
3. Click Redeploy

---
## 4. Stripe webhook rollback

1. Stripe Dashboard → Developers → Webhooks → whisperm-production
2. Click Disable
3. Fix the issue
4. Re-enable and Replay failed events

---
## 5. Severity ladder

| SEV | Condition | Response | Action |
|-----|-----------|----------|--------|
| SEV0 | Production down | Immediate | Vercel rollback + page founding clients |
| SEV1 | Billing broken | 15 min | Vercel rollback or env var fix |
| SEV2 | Feature broken | 1 hour | Hotfix or feature flag |
| SEV3 | UI glitch | Next day | Normal PR |

---
## 6. Founding client contacts

| Firm | Contact | Channel |
|------|---------|--------|
| Render | TBC | Direct message |
| Skillpost | TBC | Direct message |
| Trustlayer | TBC | Direct message |

Fill in contact details before launch.
