# AGENTS.md — Repository-Wide Engineering Standards

Scope: This file applies to the entire repository unless a deeper `AGENTS.md` overrides specific rules.

## 1) Platform Context

This repository is an enterprise TypeScript monorepo built around:

- **Multi-tenant architecture** (hard tenant isolation requirements)
- **pnpm workspaces**
- **Fastify backend services**
- **Next.js frontend applications**
- **BullMQ worker services**
- **PostgreSQL** as system of record
- **Redis** for queueing/cache/distributed coordination
- **OpenTelemetry** for tracing/metrics/log correlation
- **GitHub Actions** for CI/CD

All contributors and agents must optimize for safety, determinism, tenant isolation, and production operability.

---

## 2) Architecture Rules

1. **Preserve tenant isolation at every boundary**
   - Every request, job, event, and DB transaction must carry tenant context.
   - Never mix tenant data in memory, cache keys, queues, or logs.
   - Prefer explicit tenant-scoped repositories/services over global access patterns.

2. **Use typed contracts and runtime validation**
   - Use strict TypeScript types and shared contracts for inter-package communication.
   - Validate all untrusted input (API payloads, headers, queue payloads, webhooks, env vars) using schema validation (e.g., Zod).
   - Reject invalid input with typed errors; avoid generic `Error` when domain errors are required.

3. **Keep modules cohesive and composable**
   - Prefer composition over duplication.
   - Keep functions small, deterministic, and side-effect aware.
   - Avoid deeply nested conditionals; extract guards/helpers.

4. **No breaking changes without migration path**
   - Schema/API/event changes must be backward compatible or shipped with explicit migration + rollout plan.
   - For PostgreSQL migrations: make changes rollback-safe where possible (expand/contract approach).

5. **Async/event workflows must be idempotent**
   - BullMQ processors and handlers must tolerate retries and out-of-order delivery.
   - Use idempotency keys, deduplication strategies, and transactional guards as appropriate.

6. **Infrastructure and build determinism**
   - Use pnpm workspace conventions and lockfile-based reproducibility.
   - Avoid unnecessary dependencies and avoid introducing global mutable state.

---

## 3) Security Requirements

1. **Treat all interfaces as internet-facing**
   - Validate and sanitize all external input.
   - Apply least-privilege assumptions for service-to-service and data access.

2. **Never bypass auth/RBAC controls**
   - Do not add code paths that skip authorization middleware/guards.
   - Enforce tenant and role checks in both API and background execution paths.

3. **Secrets and sensitive data handling**
   - Never hardcode credentials, tokens, API keys, or private connection strings.
   - Do not log secrets or sensitive fields (PII, auth artifacts, security tokens).
   - Use redaction where logging payload structures is required.

4. **Auditability for sensitive operations**
   - Add structured audit logging for security-relevant changes (permission changes, billing actions, tenant config/security settings).
   - Include actor, tenant, action, target, and correlation/request IDs.

5. **Secure defaults**
   - Fail closed on auth/tenant context resolution failures.
   - Prefer explicit allowlists over implicit permissive behavior.

---

## 4) Testing Standards

1. **Mandatory checks for behavior changes**
   - Add/update tests for every behavior change.
   - Minimum: unit tests for business logic.
   - Add integration tests for critical flows (auth, tenant scoping, queue processing, persistence interactions).

2. **Deterministic and isolated tests**
   - Tests must be deterministic and reproducible.
   - Mock/stub external services and nondeterministic dependencies (time, randomness, third-party APIs).

3. **Type and quality gates**
   - TypeScript strict mode is required.
   - No `any` unless explicitly justified with inline rationale.
   - Prefer async/await over raw promise chains for readability and error handling.

4. **Suggested CI verification baseline**
   - Lint
   - Typecheck
   - Unit tests
   - Integration tests (or scoped critical-path suites)

---

## 5) Pull Request Workflow

1. **Change process**
   - Inspect repository/package structure before coding.
   - Create a short implementation plan.
   - Implement the smallest viable, non-breaking slice.
   - Run lint, typecheck, and relevant tests before opening/merging.

2. **PR scope and quality**
   - Keep PRs narrowly scoped; avoid unrelated edits.
   - Use clear commit messages.
   - Document architectural tradeoffs and risk areas.

3. **PR description must include**
   - What changed and why
   - Tenant isolation/security impact
   - Migration/rollout notes (if applicable)
   - Tests run and results
   - Assumptions and known risks

4. **Review requirements**
   - Changes affecting auth, tenancy, data model, queue semantics, or observability require explicit reviewer focus on safety and rollback strategy.

---

## 6) Operational Rules

1. **Observability**
   - Use structured logging with correlation/request IDs.
   - Propagate trace context across HTTP, queue, and DB boundaries.
   - Instrument critical paths with OpenTelemetry spans and useful attributes (including tenant-safe identifiers).

2. **Reliability and rollback safety**
   - Prefer transactional safety for persistence changes.
   - Ensure retries are safe (idempotency, conflict handling, deduplication).
   - Design for partial failure: timeouts, backoff, dead-letter handling where appropriate.

3. **Runtime and deployment discipline**
   - Keep GitHub Actions workflows reproducible and cache-aware.
   - Do not merge code that cannot be built and tested in CI.
   - Maintain compatibility with Docker-based local development workflows.

4. **Data and cache hygiene**
   - Tenant-scope Redis keys and queue names/payload metadata.
   - Define TTL/retention intentionally; avoid unbounded growth patterns.

---

## 7) Non-Negotiable Defaults

- Do not invent business logic when requirements are ambiguous; ask clarifying questions.
- Do not redesign architecture without explicit justification.
- Do not introduce breaking API/schema/event changes without migration strategy.
- Do not modify unrelated files.


---

## 8) Delegation Concurrency Enforcement Scope

- `maxConcurrentDelegations` is validated by `agentCapabilityContractSchema` at schema parse time only.
- Schema parsing validates the configured delegation-concurrency contract; it does not enforce active delegation count at runtime.
- The coordination/delegation executor is responsible for runtime enforcement of active delegation counts before claiming or starting delegated work.
- Schema-time assertions are not a substitute for executor-level coordination, persistence locks, idempotency, and tenant-scoped active-count checks.

## WhatsApp Architecture Constraint (v1)

WhispeRM v1 uses a single shared WhatsApp Business Account (WABA) owned by the WhispeRM operator.

- All tenants send invitations through the shared WABA and phone number
- The invitation template (`seller_invitation_v1`) is fixed and Meta-approved at the platform level
- Tenants cannot customize the template structure in v1
- Template variables (seller name, claim URL) are populated per-capture automatically

**v2 design target:** Per-tenant WABA — each tenant connects their own Meta Business Account, phone number, and approved templates via workspace settings. The `SellerInvitationService` will route through tenant-specific credentials stored in `WorkspaceWhatsAppConfig`.

Do not build tenant-level WhatsApp credential storage in v1. Flag any work that assumes per-tenant WABA as a v2 item.
