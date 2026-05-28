import assert from "node:assert/strict";
import test from "node:test";

import {
  ObservabilityContractError,
  auditEventSchema,
  defaultLogRedactionPolicy,
  extractTraceContext,
  injectTraceContext,
  maskSecret,
  parseTelemetryContract,
  redactTelemetryValue,
  shouldSampleTelemetry,
  structuredLogSchema,
  telemetryExportContractSchema,
  telemetrySamplingPolicySchema,
  telemetrySpanSchema,
  traceContextSchema
} from "../dist/index.js";

const trace = traceContextSchema.parse({
  tenantId: "tenant-1",
  traceId: "11111111111111111111111111111111",
  spanId: "2222222222222222",
  traceFlags: "01",
  correlation: {
    correlationId: "corr-1",
    requestId: "req-1",
    traceId: "11111111111111111111111111111111",
    spanId: "2222222222222222"
  }
});

test("distributed trace propagation preserves tenant and deterministic correlation context", () => {
  const carrier = injectTraceContext(trace, { "x-existing": "keep" });

  assert.equal(carrier.traceparent, "00-11111111111111111111111111111111-2222222222222222-01");
  assert.equal(carrier["x-whisperm-tenant-id"], "tenant-1");
  assert.equal(carrier["x-whisperm-correlation-id"], "corr-1");

  const extracted = extractTraceContext(carrier, "tenant-1");
  assert.equal(extracted.tenantId, "tenant-1");
  assert.equal(extracted.traceId, trace.traceId);
  assert.equal(extracted.spanId, trace.spanId);
  assert.equal(extracted.correlation.correlationId, "corr-1");

  assert.throws(
    () => extractTraceContext(carrier, "tenant-2"),
    (error) => error instanceof ObservabilityContractError && error.code === "TRACE_TENANT_MISMATCH"
  );
});

test("replay trace semantics require original trace lineage and validate span tenant isolation", () => {
  assert.throws(() => {
    traceContextSchema.parse({
      ...trace,
      replay: { mode: "REPLAY", deterministic: true }
    });
  });

  const replayTrace = traceContextSchema.parse({
    ...trace,
    replay: {
      mode: "REPLAY",
      originalTraceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      replayId: "replay-1",
      deterministic: true
    }
  });

  const span = telemetrySpanSchema.parse({
    spanModel: "WORKFLOW_EXECUTION",
    name: "workflow.execute",
    kind: "INTERNAL",
    tenantId: "tenant-1",
    context: replayTrace,
    startedAt: "2026-01-01T00:00:00.000Z",
    workflowId: "workflow-1",
    workflowVersion: 1,
    executionId: "exec-1",
    replayMode: "REPLAY"
  });

  assert.equal(span.replayMode, "REPLAY");
  assert.equal(span.context.replay.originalTraceId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  assert.throws(() => {
    telemetrySpanSchema.parse({ ...span, tenantId: "tenant-2" });
  });
});

test("redaction policy masks secrets and PII without mutating the source payload", () => {
  const payload = {
    email: "ada@example.com",
    nested: {
      apiToken: "tok_123456789",
      publicValue: "visible"
    },
    password: "super-secret"
  };

  const redacted = redactTelemetryValue(payload, defaultLogRedactionPolicy);

  assert.equal(redacted.email, "[REDACTED]");
  assert.equal(redacted.nested.apiToken, "to[SECRET]89");
  assert.equal(redacted.nested.publicValue, "visible");
  assert.equal(redacted.password, "su[SECRET]et");
  assert.equal(payload.email, "ada@example.com");
  assert.equal(maskSecret("abcd"), "[SECRET]");
});

test("sampling policy is deterministic per tenant correlation and always samples errors and replay", () => {
  const policy = telemetrySamplingPolicySchema.parse({
    policyId: "policy-1",
    defaultRatio: 0,
    tenantOverrides: { "tenant-2": 1 }
  });

  assert.equal(shouldSampleTelemetry({ tenantId: "tenant-1", correlationId: "corr-1", policy }), "RECORD_ONLY");
  assert.equal(shouldSampleTelemetry({ tenantId: "tenant-2", correlationId: "corr-1", policy }), "RECORD_AND_SAMPLE");
  assert.equal(shouldSampleTelemetry({ tenantId: "tenant-1", correlationId: "corr-1", policy, severity: "ERROR" }), "RECORD_AND_SAMPLE");
  assert.equal(shouldSampleTelemetry({ tenantId: "tenant-1", correlationId: "corr-1", policy, replayMode: "REPLAY" }), "RECORD_AND_SAMPLE");

  const halfPolicy = telemetrySamplingPolicySchema.parse({ policyId: "policy-half", defaultRatio: 0.5 });
  assert.equal(
    shouldSampleTelemetry({ tenantId: "tenant-1", correlationId: "stable-correlation", policy: halfPolicy }),
    shouldSampleTelemetry({ tenantId: "tenant-1", correlationId: "stable-correlation", policy: halfPolicy })
  );
});

test("telemetry validation covers logs, audit events, export contracts, and typed validation errors", () => {
  const log = structuredLogSchema.parse({
    timestamp: "2026-01-01T00:00:00.000Z",
    severity: "INFO",
    message: "execution started",
    tenantId: "tenant-1",
    service: "api",
    correlation: trace.correlation,
    trace,
    attributes: { executionId: "exec-1" },
    redactionPolicyId: defaultLogRedactionPolicy.policyId
  });
  assert.equal(log.tenantId, "tenant-1");

  const audit = auditEventSchema.parse({
    eventId: "audit-1",
    tenantId: "tenant-1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    actorId: "user-1",
    action: "tenant.settings.update",
    target: { type: "tenant", id: "tenant-1" },
    outcome: "SUCCEEDED",
    correlation: trace.correlation,
    trace,
    idempotencyKey: "tenant-1:audit-1"
  });
  assert.equal(audit.idempotencyKey, "tenant-1:audit-1");

  const exportContract = telemetryExportContractSchema.parse({ exporter: "OTLP_HTTP", enabled: false });
  assert.equal(exportContract.batchSize, 512);

  assert.throws(
    () => parseTelemetryContract(structuredLogSchema, { ...log, tenantId: "tenant-2" }, trace.correlation),
    (error) => error instanceof ObservabilityContractError && error.code === "TELEMETRY_VALIDATION_FAILED"
  );
});
