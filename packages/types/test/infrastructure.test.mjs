import assert from "node:assert/strict";
import test from "node:test";

import {
  InfrastructureRuntimeError,
  evaluateInfrastructureHealth,
  validateDeployment,
  validateEnvironment,
  validateInfrastructureDependencies,
  validateSecretReferences
} from "../dist/index.js";

const checkedAt = "2026-05-29T00:00:00.000Z";

const environment = {
  id: "env-prod-us",
  name: "Production US",
  tier: "PRODUCTION",
  status: "ACTIVE",
  regions: ["us-east-1", "us-west-2"],
  tenantIsolation: {
    mode: "SHARED_WITH_STRICT_SCOPING",
    allowedTenantIds: ["tenant-1"],
    requiredTenantContext: true,
    tenantScopedCacheKeys: true,
    tenantScopedQueuePayloads: true,
    tenantScopedStoragePaths: true,
    tenantSafeDiagnostics: true
  }
};

const deployment = {
  id: "deploy-1",
  environmentId: "env-prod-us",
  version: "1.0.0",
  revision: "git-sha-1",
  tenantIsolation: environment.tenantIsolation,
  services: [
    {
      id: "api",
      name: "API",
      kind: "HTTP_API",
      version: "1.0.0",
      discovery: {
        protocol: "HTTPS",
        logicalName: "api.internal",
        tenantScoped: true
      },
      healthCheck: {
        path: "/health",
        intervalSeconds: 30,
        timeoutSeconds: 5,
        failureThreshold: 3
      },
      dependsOn: [],
      secretRefs: ["api-db-url"],
      configurationRefs: ["runtime-config"],
      tenantScoped: true,
      critical: true
    },
    {
      id: "worker",
      name: "Worker",
      kind: "WORKER",
      version: "1.0.0",
      discovery: {
        protocol: "QUEUE",
        logicalName: "worker.internal",
        tenantScoped: true
      },
      dependsOn: ["api"],
      secretRefs: [],
      configurationRefs: ["runtime-config"],
      tenantScoped: true,
      critical: true
    }
  ],
  dependencies: [
    {
      id: "postgres",
      kind: "POSTGRES",
      name: "Primary Postgres",
      required: true,
      tenantScoped: true,
      serviceIds: ["api", "worker"],
      dependsOn: [],
      discovery: {
        protocol: "POSTGRES",
        logicalName: "postgres.internal",
        tenantScoped: true
      }
    },
    {
      id: "redis",
      kind: "REDIS",
      name: "Redis",
      required: true,
      tenantScoped: true,
      serviceIds: ["worker"],
      dependsOn: [],
      discovery: {
        protocol: "REDIS",
        logicalName: "redis.internal",
        tenantScoped: true
      }
    }
  ],
  secretReferences: [
    {
      id: "api-db-url",
      provider: "secrets-manager",
      key: "prod/api/database-url",
      scope: "SERVICE",
      serviceId: "api",
      required: true,
      rotationDays: 90
    },
    {
      id: "tenant-oauth",
      provider: "secrets-manager",
      key: "prod/tenant-1/oauth",
      scope: "TENANT",
      tenantId: "tenant-1",
      required: true
    }
  ],
  configurationProviders: [
    {
      id: "runtime-config",
      provider: "environment",
      environmentId: "env-prod-us",
      values: {
        LOG_LEVEL: "info",
        RETRIES: 3
      },
      secretRefs: ["tenant-oauth"],
      tenantScoped: true,
      immutable: true
    }
  ],
  backupPolicies: [
    {
      id: "postgres-backup",
      targetDependencyIds: ["postgres"],
      schedule: {
        intervalMinutes: 60,
        retentionDays: 30,
        recoveryPointObjectiveMinutes: 60
      },
      encrypted: true,
      tenantScoped: true,
      verificationRequired: true
    }
  ],
  restorePolicies: [
    {
      id: "postgres-restore",
      backupPolicyId: "postgres-backup",
      recoveryTimeObjectiveMinutes: 120,
      requiresApproval: true,
      tenantScopedRestore: true,
      testFrequencyDays: 30
    }
  ],
  disasterRecoveryPolicies: [
    {
      id: "prod-dr",
      environmentId: "env-prod-us",
      failoverEnvironmentId: "env-dr-us",
      backupPolicyIds: ["postgres-backup"],
      restorePolicyIds: ["postgres-restore"],
      runbookRef: "runbooks/prod-dr.md",
      tenantIsolationVerified: true
    }
  ]
};

test("environment validation enforces production tenant allowlist", () => {
  const result = validateEnvironment(environment);
  assert.equal(result.id, "env-prod-us");
  assert.equal(result.tenantIsolation.requiredTenantContext, true);

  assert.throws(() => validateEnvironment({
    ...environment,
    tenantIsolation: {
      ...environment.tenantIsolation,
      allowedTenantIds: []
    }
  }), InfrastructureRuntimeError);
});

test("deployment validation resolves services, dependencies, secrets, config, backup, restore, and DR references", () => {
  const result = validateDeployment(deployment, validateEnvironment(environment));
  assert.equal(result.services.length, 2);
  assert.equal(result.dependencies.length, 2);

  assert.throws(() => validateDeployment({
    ...deployment,
    services: [
      {
        ...deployment.services[0],
        secretRefs: ["missing-secret"]
      }
    ]
  }, environment), InfrastructureRuntimeError);
});

test("deployment dependency validation rejects unresolved dependency service references", () => {
  assert.throws(() => validateInfrastructureDependencies([
    {
      id: "postgres",
      kind: "POSTGRES",
      name: "Primary Postgres",
      required: true,
      tenantScoped: true,
      serviceIds: ["missing-service"],
      dependsOn: []
    }
  ], ["api"]), InfrastructureRuntimeError);
});

test("secret reference validation rejects tenant scoped secrets outside the environment allowlist", () => {
  assert.throws(() => validateSecretReferences([
    {
      id: "tenant-secret",
      provider: "secrets-manager",
      key: "prod/tenant-2/oauth",
      scope: "TENANT",
      tenantId: "tenant-2",
      required: true
    }
  ], ["api"], ["tenant-1"]), InfrastructureRuntimeError);
});

test("health evaluation aggregates service and dependency status deterministically", () => {
  const report = evaluateInfrastructureHealth({
    environment,
    deployment,
    checkedAt,
    serviceHealth: [
      {
        serviceId: "api",
        status: "HEALTHY",
        checkedAt,
        findings: []
      },
      {
        serviceId: "worker",
        status: "DEGRADED",
        checkedAt,
        findings: [
          {
            code: "QUEUE_LAG_HIGH",
            message: "Worker queue lag is above objective",
            severity: "WARNING",
            targetId: "worker",
            tenantSafe: true
          }
        ]
      }
    ],
    dependencyHealth: [
      {
        dependencyId: "postgres",
        status: "HEALTHY",
        checkedAt,
        findings: []
      },
      {
        dependencyId: "redis",
        status: "HEALTHY",
        checkedAt,
        findings: []
      }
    ]
  });

  assert.equal(report.status, "DEGRADED");
  assert.equal(report.deployment.status, "DEGRADED");
  assert.equal(report.tenantIsolationVerified, true);
});

test("health evaluation fails closed when critical health reports are missing", () => {
  const report = evaluateInfrastructureHealth({
    environment,
    deployment,
    checkedAt,
    serviceHealth: [
      {
        serviceId: "api",
        status: "HEALTHY",
        checkedAt,
        findings: []
      }
    ],
    dependencyHealth: []
  });

  assert.equal(report.status, "UNKNOWN");
  assert.equal(report.findings.some((finding) => finding.code === "SERVICE_HEALTH_MISSING"), true);
  assert.equal(report.findings.some((finding) => finding.code === "DEPENDENCY_HEALTH_MISSING"), true);
});
