# Neon Production Baseline and Migration Operations

## Production baseline concept

The production Neon database has an existing schema state that may predate local Prisma migration history. A baseline is an explicit acknowledgement that production already contains a migration's effects, so Prisma migration tracking can be aligned without replaying destructive or duplicate SQL.

Baselining is an operational action, not a development shortcut. It must only happen after confirming the production schema exactly matches the expected migration effects.

## When to use `prisma migrate resolve`

Use `prisma migrate resolve --applied <migration_name>` only when all of the following are true:

1. The migration's schema changes already exist in production.
2. Production verification proves the database objects, indexes, constraints, and data posture match expectations.
3. The migration has not been recorded in `_prisma_migrations`.
4. The team has an approved backup and rollback posture.

`migrate resolve` records migration state; it does not safely transform production schema by itself.

## When to use `prisma migrate deploy`

Use `prisma migrate deploy` for normal forward production migration after validating the migration chain in CI/staging. Deploy should be the default for unapplied migrations whose SQL still needs to run in production.

Before deploy, confirm the target branch, database URL, migration order, and expected lock/DDL behavior. Prefer an expand/contract approach for changes that can affect live application traffic.

## Safety checks before production migration

- Confirm the target is the production Neon project and branch intended for the operation.
- Inspect `_prisma_migrations` and compare it with repository migration names.
- Verify schema state with read-only introspection before any baseline action.
- Confirm application compatibility for both old and new schema during rollout.
- Take or verify a restorable backup/snapshot immediately before the operation.
- Document who is executing, who is reviewing, and the exact command to be run.
- Ensure monitoring is available for database errors, application errors, queue retries, and latency.

## Required backup and verification posture

A production migration or baseline requires a recent restorable backup, a rollback decision point, and post-command verification. Verification should include Prisma migration table state, selected schema objects, and an application smoke test against tenant-scoped critical paths.

## What not to do

- Do not reset production.
- Do not rename applied migrations.
- Do not casually edit applied migration SQL.
- Do not baseline without confirming production schema state.
- Do not use local shadow-database assumptions as proof of production state.

## Migration naming convention

New Prisma migrations must use a unique timestamp prefix followed by a short descriptive snake_case name, for example `20260618123000_add_marketplace_capture_indexes`. Never reuse a timestamp prefix for a new migration.

The duplicate historical timestamp prefix `20260614000000` is a known hygiene issue with no current production impact. Do not rename those existing migrations; treat the names as immutable production history.

## Seller Acquisition Neon baseline performed

The Seller Acquisition Neon migration baseline that has been recorded for future operators is:

1. The first two migrations were marked applied.
2. The remaining Seller Acquisition migrations were deployed.
3. The final migrate status was `Database schema is up to date`.

This is an operational baseline record, not permission to skip verification. Before future Seller Acquisition migration work, verify the target Neon project and branch, inspect `_prisma_migrations`, compare the repository migration history, and confirm the expected schema state.

## Production command safety warnings

- Never run `prisma migrate reset` against Neon production or any shared Neon branch.
- Use `prisma migrate deploy`, not `prisma migrate dev`, for production migration work.
- Verify `DATABASE_URL` before migration work, including project, branch, database, role, and environment.
- Do not run migration commands from a shell where `DATABASE_URL` may point at the wrong tenant, branch, preview database, or production database.
