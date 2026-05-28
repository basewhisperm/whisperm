import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthError,
  hasRequiredRole,
  loadTenantMembershipMiddleware,
  roleGuardMiddleware,
  tenantIsolationGuardMiddleware
} from "../dist/index.js";

const createRequest = (overrides = {}) => ({
  headers: { "x-tenant-id": "tenant-1" },
  correlationId: "corr-1",
  auth: {
    principal: {
      userId: "user-1",
      externalSubject: "user-1",
      tenantIds: ["tenant-1"],
      token: {
        subject: "user-1",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        tenantIds: ["tenant-1"],
        raw: {}
      }
    }
  },
  ...overrides
});

test("role hierarchy allows higher roles to satisfy lower role requirements", () => {
  assert.equal(hasRequiredRole("OWNER", "ADMIN"), true);
  assert.equal(hasRequiredRole("ADMIN", "MEMBER"), true);
  assert.equal(hasRequiredRole("MEMBER", "VIEWER"), true);
  assert.equal(hasRequiredRole("VIEWER", "MEMBER"), false);
});

test("role guard fails closed when membership is missing", () => {
  const guard = roleGuardMiddleware("MEMBER");

  assert.throws(
    () => guard(createRequest()),
    (error) => error instanceof AuthError && error.code === "AUTH_FORBIDDEN"
  );
});

test("role guard permits requests with sufficient active tenant role", () => {
  const request = createRequest({
    auth: {
      principal: createRequest().auth.principal,
      membership: {
        tenantId: "tenant-1",
        userId: "user-1",
        role: "ADMIN",
        isActive: true
      }
    }
  });

  assert.doesNotThrow(() => roleGuardMiddleware("MEMBER")(request));
});

test("tenant membership loading rejects tenant IDs not present in the access token", async () => {
  const request = createRequest({ headers: { "x-tenant-id": "tenant-2" } });
  const loader = {
    async loadMembership() {
      assert.fail("loader must not be called for mismatched tenant tokens");
    }
  };

  await assert.rejects(
    async () => loadTenantMembershipMiddleware(loader)(request),
    (error) => error instanceof AuthError && error.code === "TENANT_CONTEXT_MISMATCH"
  );
});

test("tenant membership loading fails closed for missing memberships", async () => {
  const loader = {
    async loadMembership() {
      return null;
    }
  };

  await assert.rejects(
    async () => loadTenantMembershipMiddleware(loader)(createRequest()),
    (error) => error instanceof AuthError && error.code === "AUTH_MEMBERSHIP_REQUIRED"
  );
});

test("tenant membership loading rejects inactive memberships", async () => {
  const loader = {
    async loadMembership() {
      return {
        tenantId: "tenant-1",
        userId: "user-1",
        role: "MEMBER",
        isActive: false
      };
    }
  };

  await assert.rejects(
    async () => loadTenantMembershipMiddleware(loader)(createRequest()),
    (error) => error instanceof AuthError && error.code === "AUTH_MEMBERSHIP_INACTIVE"
  );
});

test("tenant membership loading attaches verified active membership", async () => {
  const loader = {
    async loadMembership() {
      return {
        tenantId: "tenant-1",
        userId: "user-1",
        role: "MEMBER",
        isActive: true
      };
    }
  };
  const request = createRequest();

  await loadTenantMembershipMiddleware(loader)(request);

  assert.equal(request.tenant.role, "MEMBER");
  assert.equal(request.auth.membership.tenantId, "tenant-1");
});

test("tenant isolation guard fails closed when header and membership tenant differ", () => {
  const request = createRequest({
    headers: { "x-tenant-id": "tenant-2" },
    auth: {
      principal: createRequest().auth.principal,
      membership: {
        tenantId: "tenant-1",
        userId: "user-1",
        role: "ADMIN",
        isActive: true
      }
    }
  });

  assert.throws(
    () => tenantIsolationGuardMiddleware()(request),
    (error) => error instanceof AuthError && error.code === "TENANT_CONTEXT_MISMATCH"
  );
});
