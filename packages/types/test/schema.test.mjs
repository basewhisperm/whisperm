import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  apiResponseEnvelopeSchema,
  correlationMetadataSchema,
  errorModelSchema,
  eventEnvelopeSchema,
  tenantMembershipSchema,
  tenantRequestContextSchema,
  tenantRoleSchema
} from "../dist/index.js";

test("correlation metadata schema validates expected shape", () => {
  const result = correlationMetadataSchema.parse({
    correlationId: "corr-1",
    requestId: "req-1"
  });

  assert.equal(result.correlationId, "corr-1");
});

test("tenant request context schema requires tenantId and correlation", () => {
  const result = tenantRequestContextSchema.parse({
    tenantId: "tenant-1",
    correlation: { correlationId: "corr-1" }
  });

  assert.equal(result.tenantId, "tenant-1");

  assert.throws(() => {
    tenantRequestContextSchema.parse({
      correlation: { correlationId: "corr-1" }
    });
  });
});

test("error model schema validates HTTP-safe typed error payload", () => {
  const result = errorModelSchema.parse({
    code: "INVALID_INPUT",
    message: "Request body failed validation",
    status: 400,
    details: { field: "email" }
  });

  assert.equal(result.status, 400);

  assert.throws(() => {
    errorModelSchema.parse({
      code: "X",
      message: "bad",
      status: 200
    });
  });
});

test("api response envelope schema discriminates success and error responses", () => {
  const dataSchema = z.object({ id: z.string() });
  const schema = apiResponseEnvelopeSchema(dataSchema);

  const successResult = schema.parse({
    ok: true,
    data: { id: "abc" }
  });

  assert.equal(successResult.ok, true);

  const errorResult = schema.parse({
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Missing",
      status: 404
    }
  });

  assert.equal(errorResult.ok, false);
});

test("event envelope schema enforces tenant-aware metadata and payload", () => {
  const schema = eventEnvelopeSchema(z.object({ value: z.number().int() }));

  const result = schema.parse({
    id: "evt-1",
    type: "whisperm.example.created",
    version: 1,
    occurredAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    tenantId: "tenant-1",
    payload: { value: 1 },
    correlation: { correlationId: "corr-1" }
  });

  assert.equal(result.tenantId, "tenant-1");

  assert.throws(() => {
    schema.parse({
      id: "evt-1",
      type: "whisperm.example.created",
      version: 1,
      occurredAt: "invalid-date",
      tenantId: "tenant-1",
      payload: { value: 1 },
      correlation: { correlationId: "corr-1" }
    });
  });
});


test("tenant role schema mirrors Prisma TenantRole contract", () => {
  assert.equal(tenantRoleSchema.parse("OWNER"), "OWNER");
  assert.equal(tenantRoleSchema.parse("ADMIN"), "ADMIN");
  assert.equal(tenantRoleSchema.parse("MEMBER"), "MEMBER");
  assert.equal(tenantRoleSchema.parse("VIEWER"), "VIEWER");

  assert.throws(() => {
    tenantRoleSchema.parse("SUPER_ADMIN");
  });
});

test("tenant membership schema validates active tenant-scoped role data", () => {
  const membership = tenantMembershipSchema.parse({
    tenantId: "tenant-1",
    userId: "user-1",
    role: "ADMIN",
    isActive: true,
    email: "admin@example.com"
  });

  assert.equal(membership.role, "ADMIN");

  assert.throws(() => {
    tenantMembershipSchema.parse({
      tenantId: "tenant-1",
      userId: "user-1",
      role: "INVALID",
      isActive: true
    });
  });
});
