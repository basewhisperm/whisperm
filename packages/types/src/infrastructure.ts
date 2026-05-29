import { z } from "zod";

export const infrastructureCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();
export type InfrastructureCorrelationMetadata = z.infer<typeof infrastructureCorrelationMetadataSchema>;

export const infrastructureErrorCodeValues = [
  "INFRASTRUCTURE_VALIDATION_FAILED",
  "INFRASTRUCTURE_ENVIRONMENT_INVALID",
  "INFRASTRUCTURE_DEPLOYMENT_INVALID",
  "INFRASTRUCTURE_DEPENDENCY_INVALID",
  "INFRASTRUCTURE_SECRET_REFERENCE_INVALID",
  "INFRASTRUCTURE_HEALTH_INVALID"
] as const;
export const infrastructureErrorCodeSchema = z.enum(infrastructureErrorCodeValues);
export type InfrastructureErrorCode = z.infer<typeof infrastructureErrorCodeSchema>;

export const infrastructureErrorDetailsSchema = z.record(z.string(), z.unknown());
export type InfrastructureErrorDetails = z.infer<typeof infrastructureErrorDetailsSchema>;

export const infrastructureErrorModelSchema = z.object({
  code: infrastructureErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
  details: infrastructureErrorDetailsSchema.optional(),
  correlation: infrastructureCorrelationMetadataSchema.optional()
}).strict();
export type InfrastructureErrorModel = z.infer<typeof infrastructureErrorModelSchema>;

export interface InfrastructureRuntimeErrorInput {
  readonly code: InfrastructureErrorCode;
  readonly message: string;
  readonly status: number;
  readonly details?: InfrastructureErrorDetails | undefined;
  readonly correlation?: InfrastructureCorrelationMetadata | undefined;
}

export class InfrastructureRuntimeError extends Error {
  readonly code: InfrastructureErrorCode;
  readonly status: number;
  readonly details?: InfrastructureErrorDetails | undefined;
  readonly correlation?: InfrastructureCorrelationMetadata | undefined;

  constructor(input: InfrastructureRuntimeErrorInput) {
    super(input.message);
    this.name = "InfrastructureRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, InfrastructureRuntimeError.prototype);
  }

  toErrorModel(): InfrastructureErrorModel {
    return infrastructureErrorModelSchema.parse({
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      correlation: this.correlation
    });
  }
}

const validationIssues = (error: z.ZodError): readonly InfrastructureErrorDetails[] => error.issues.map((issue) => ({
  path: issue.path.join("."),
  message: issue.message,
  code: issue.code
}));

const parseInfrastructureSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  code: InfrastructureErrorCode,
  message: string,
  correlation?: InfrastructureCorrelationMetadata
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new InfrastructureRuntimeError({
      code,
      message,
      status: 400,
      details: { issues: validationIssues(result.error) },
      correlation
    });
  }
  return result.data;
};

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const hasDuplicate = (values: readonly string[]): boolean => !unique(values);
const missingReferences = (requiredIds: readonly string[], availableIds: ReadonlySet<string>): readonly string[] =>
  requiredIds.filter((id) => !availableIds.has(id));

export const deploymentTierValues = ["LOCAL", "DEVELOPMENT", "STAGING", "PRODUCTION", "DISASTER_RECOVERY"] as const;
export const deploymentTierSchema = z.enum(deploymentTierValues);
export type DeploymentTier = z.infer<typeof deploymentTierSchema>;

export const environmentStatusValues = ["PLANNED", "ACTIVE", "DEGRADED", "SUSPENDED", "DECOMMISSIONED"] as const;
export const environmentStatusSchema = z.enum(environmentStatusValues);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const tenantIsolationModeValues = ["SHARED_WITH_STRICT_SCOPING", "DEDICATED_TENANT", "DEDICATED_REGION"] as const;
export const tenantIsolationModeSchema = z.enum(tenantIsolationModeValues);
export type TenantIsolationMode = z.infer<typeof tenantIsolationModeSchema>;

export const tenantIsolationInfrastructureContractSchema = z.object({
  mode: tenantIsolationModeSchema,
  requiredTenantContext: z.literal(true).default(true),
  tenantScopedCacheKeys: z.literal(true).default(true),
  tenantScopedQueuePayloads: z.literal(true).default(true),
  tenantScopedStoragePaths: z.literal(true).default(true),
  tenantSafeDiagnostics: z.literal(true).default(true),
  allowedTenantIds: z.array(z.string().min(1)).default([])
}).strict();
export type TenantIsolationInfrastructureContract = z.output<typeof tenantIsolationInfrastructureContractSchema>;

export const environmentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: deploymentTierSchema,
  status: environmentStatusSchema.default("PLANNED"),
  regions: z.array(z.string().min(1)).min(1),
  tenantIsolation: tenantIsolationInfrastructureContractSchema,
  labels: z.record(z.string().min(1), z.string().min(1)).default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
}).strict().superRefine((value, context) => {
  if (hasDuplicate(value.regions)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Environment regions must be unique", path: ["regions"] });
  }
  if (value.tier === "PRODUCTION" && value.tenantIsolation.mode === "SHARED_WITH_STRICT_SCOPING" && value.tenantIsolation.allowedTenantIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Shared production environments must declare allowed tenant IDs", path: ["tenantIsolation", "allowedTenantIds"] });
  }
});
export type EnvironmentDefinition = z.output<typeof environmentDefinitionSchema>;

export const serviceKindValues = ["HTTP_API", "WEB_APP", "WORKER", "SCHEDULER", "DATABASE", "CACHE", "QUEUE", "OBJECT_STORAGE", "OBSERVABILITY", "EXTERNAL"] as const;
export const serviceKindSchema = z.enum(serviceKindValues);
export type ServiceKind = z.infer<typeof serviceKindSchema>;

export const serviceDiscoveryProtocolValues = ["HTTP", "HTTPS", "TCP", "POSTGRES", "REDIS", "QUEUE", "OTLP", "INTERNAL"] as const;
export const serviceDiscoveryProtocolSchema = z.enum(serviceDiscoveryProtocolValues);
export type ServiceDiscoveryProtocol = z.infer<typeof serviceDiscoveryProtocolSchema>;

export const serviceDiscoverySchema = z.object({
  protocol: serviceDiscoveryProtocolSchema,
  logicalName: z.string().min(1),
  endpoint: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  tenantScoped: z.literal(true).default(true)
}).strict();
export type ServiceDiscovery = z.output<typeof serviceDiscoverySchema>;

export const healthCheckDefinitionSchema = z.object({
  path: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  intervalSeconds: z.number().int().positive().max(86_400),
  timeoutSeconds: z.number().int().positive().max(3_600),
  failureThreshold: z.number().int().positive().max(100)
}).strict().refine((value) => value.path !== undefined || value.command !== undefined, {
  message: "Health checks require either path or command",
  path: ["path"]
});
export type HealthCheckDefinition = z.output<typeof healthCheckDefinitionSchema>;

export const serviceDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: serviceKindSchema,
  version: z.string().min(1),
  discovery: serviceDiscoverySchema,
  healthCheck: healthCheckDefinitionSchema.optional(),
  dependsOn: z.array(z.string().min(1)).default([]),
  secretRefs: z.array(z.string().min(1)).default([]),
  configurationRefs: z.array(z.string().min(1)).default([]),
  tenantScoped: z.literal(true).default(true),
  critical: z.boolean().default(true)
}).strict().superRefine((value, context) => {
  if (hasDuplicate(value.dependsOn)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Service dependencies must be unique", path: ["dependsOn"] });
  }
  if (hasDuplicate(value.secretRefs)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Service secret references must be unique", path: ["secretRefs"] });
  }
});
export type ServiceDefinition = z.output<typeof serviceDefinitionSchema>;

export const infrastructureDependencyKindValues = ["POSTGRES", "REDIS", "BULLMQ", "OBJECT_STORAGE", "SECRETS_MANAGER", "OTEL_COLLECTOR", "EMAIL_PROVIDER", "SOCIAL_PROVIDER", "HTTP_SERVICE", "CUSTOM"] as const;
export const infrastructureDependencyKindSchema = z.enum(infrastructureDependencyKindValues);
export type InfrastructureDependencyKind = z.infer<typeof infrastructureDependencyKindSchema>;

export const infrastructureDependencySchema = z.object({
  id: z.string().min(1),
  kind: infrastructureDependencyKindSchema,
  name: z.string().min(1),
  required: z.boolean().default(true),
  tenantScoped: z.literal(true).default(true),
  serviceIds: z.array(z.string().min(1)).default([]),
  dependsOn: z.array(z.string().min(1)).default([]),
  discovery: serviceDiscoverySchema.optional(),
  minimumVersion: z.string().min(1).optional(),
  diagnostics: z.record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()])).default({})
}).strict().superRefine((value, context) => {
  if (hasDuplicate(value.serviceIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Dependency service IDs must be unique", path: ["serviceIds"] });
  }
  if (hasDuplicate(value.dependsOn)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Dependency references must be unique", path: ["dependsOn"] });
  }
});
export type InfrastructureDependency = z.output<typeof infrastructureDependencySchema>;

export const secretScopeValues = ["ENVIRONMENT", "SERVICE", "TENANT"] as const;
export const secretScopeSchema = z.enum(secretScopeValues);
export type SecretScope = z.infer<typeof secretScopeSchema>;

export const secretReferenceSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  key: z.string().min(1),
  version: z.string().min(1).optional(),
  scope: secretScopeSchema,
  tenantId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  required: z.boolean().default(true),
  rotationDays: z.number().int().positive().max(3_650).optional()
}).strict().superRefine((value, context) => {
  if (value.scope === "TENANT" && value.tenantId === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Tenant scoped secrets require tenantId", path: ["tenantId"] });
  }
  if (value.scope === "SERVICE" && value.serviceId === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Service scoped secrets require serviceId", path: ["serviceId"] });
  }
});
export type SecretReference = z.output<typeof secretReferenceSchema>;

export const configurationValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number()), z.array(z.boolean())]);
export type ConfigurationValue = z.infer<typeof configurationValueSchema>;

export const configurationProviderSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  environmentId: z.string().min(1),
  values: z.record(z.string().min(1), configurationValueSchema).default({}),
  secretRefs: z.array(z.string().min(1)).default([]),
  tenantScoped: z.literal(true).default(true),
  immutable: z.literal(true).default(true)
}).strict().refine((value) => unique(value.secretRefs), {
  message: "Configuration secret references must be unique",
  path: ["secretRefs"]
});
export type ConfigurationProvider = z.output<typeof configurationProviderSchema>;

export const backupScheduleSchema = z.object({
  intervalMinutes: z.number().int().positive().max(525_600),
  retentionDays: z.number().int().positive().max(3_650),
  recoveryPointObjectiveMinutes: z.number().int().positive().max(525_600)
}).strict();
export type BackupSchedule = z.output<typeof backupScheduleSchema>;

export const backupPolicySchema = z.object({
  id: z.string().min(1),
  targetDependencyIds: z.array(z.string().min(1)).min(1),
  schedule: backupScheduleSchema,
  encrypted: z.literal(true).default(true),
  tenantScoped: z.literal(true).default(true),
  verificationRequired: z.literal(true).default(true)
}).strict().refine((value) => unique(value.targetDependencyIds), {
  message: "Backup target dependency IDs must be unique",
  path: ["targetDependencyIds"]
});
export type BackupPolicy = z.output<typeof backupPolicySchema>;

export const restorePolicySchema = z.object({
  id: z.string().min(1),
  backupPolicyId: z.string().min(1),
  recoveryTimeObjectiveMinutes: z.number().int().positive().max(525_600),
  requiresApproval: z.literal(true).default(true),
  tenantScopedRestore: z.literal(true).default(true),
  testFrequencyDays: z.number().int().positive().max(3_650)
}).strict();
export type RestorePolicy = z.output<typeof restorePolicySchema>;

export const disasterRecoveryPolicySchema = z.object({
  id: z.string().min(1),
  environmentId: z.string().min(1),
  failoverEnvironmentId: z.string().min(1),
  backupPolicyIds: z.array(z.string().min(1)).min(1),
  restorePolicyIds: z.array(z.string().min(1)).min(1),
  runbookRef: z.string().min(1),
  tenantIsolationVerified: z.literal(true).default(true),
  lastExerciseAt: z.string().datetime().optional()
}).strict().superRefine((value, context) => {
  if (value.environmentId === value.failoverEnvironmentId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Failover environment must differ from primary environment", path: ["failoverEnvironmentId"] });
  }
  if (hasDuplicate(value.backupPolicyIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DR backup policy IDs must be unique", path: ["backupPolicyIds"] });
  }
  if (hasDuplicate(value.restorePolicyIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DR restore policy IDs must be unique", path: ["restorePolicyIds"] });
  }
});
export type DisasterRecoveryPolicy = z.output<typeof disasterRecoveryPolicySchema>;

export const deploymentDefinitionSchema = z.object({
  id: z.string().min(1),
  environmentId: z.string().min(1),
  version: z.string().min(1),
  revision: z.string().min(1),
  services: z.array(serviceDefinitionSchema).min(1),
  dependencies: z.array(infrastructureDependencySchema).default([]),
  secretReferences: z.array(secretReferenceSchema).default([]),
  configurationProviders: z.array(configurationProviderSchema).default([]),
  backupPolicies: z.array(backupPolicySchema).default([]),
  restorePolicies: z.array(restorePolicySchema).default([]),
  disasterRecoveryPolicies: z.array(disasterRecoveryPolicySchema).default([]),
  tenantIsolation: tenantIsolationInfrastructureContractSchema,
  createdAt: z.string().datetime().optional()
}).strict().superRefine((value, context) => {
  const serviceIds = value.services.map((service) => service.id);
  const dependencyIds = value.dependencies.map((dependency) => dependency.id);
  const secretIds = value.secretReferences.map((secret) => secret.id);
  const configIds = value.configurationProviders.map((provider) => provider.id);
  const backupPolicyIds = value.backupPolicies.map((policy) => policy.id);
  const restorePolicyIds = value.restorePolicies.map((policy) => policy.id);

  if (hasDuplicate(serviceIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deployment service IDs must be unique", path: ["services"] });
  }
  if (hasDuplicate(dependencyIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deployment dependency IDs must be unique", path: ["dependencies"] });
  }
  if (hasDuplicate(secretIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deployment secret reference IDs must be unique", path: ["secretReferences"] });
  }
  if (hasDuplicate(configIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deployment configuration provider IDs must be unique", path: ["configurationProviders"] });
  }
  if (hasDuplicate(backupPolicyIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deployment backup policy IDs must be unique", path: ["backupPolicies"] });
  }
  if (hasDuplicate(restorePolicyIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deployment restore policy IDs must be unique", path: ["restorePolicies"] });
  }
});
export type DeploymentDefinition = z.output<typeof deploymentDefinitionSchema>;

export const infrastructureHealthStatusValues = ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"] as const;
export const infrastructureHealthStatusSchema = z.enum(infrastructureHealthStatusValues);
export type InfrastructureHealthStatus = z.infer<typeof infrastructureHealthStatusSchema>;

export const healthFindingSeverityValues = ["INFO", "WARNING", "CRITICAL"] as const;
export const healthFindingSeveritySchema = z.enum(healthFindingSeverityValues);
export type HealthFindingSeverity = z.infer<typeof healthFindingSeveritySchema>;

export const infrastructureHealthFindingSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: healthFindingSeveritySchema,
  targetId: z.string().min(1).optional(),
  tenantSafe: z.literal(true).default(true)
}).strict();
export type InfrastructureHealthFinding = z.output<typeof infrastructureHealthFindingSchema>;

export const serviceHealthReportSchema = z.object({
  serviceId: z.string().min(1),
  status: infrastructureHealthStatusSchema,
  checkedAt: z.string().datetime(),
  findings: z.array(infrastructureHealthFindingSchema).default([])
}).strict();
export type ServiceHealthReport = z.output<typeof serviceHealthReportSchema>;

export const deploymentHealthReportSchema = z.object({
  deploymentId: z.string().min(1),
  environmentId: z.string().min(1),
  status: infrastructureHealthStatusSchema,
  checkedAt: z.string().datetime(),
  services: z.array(serviceHealthReportSchema),
  findings: z.array(infrastructureHealthFindingSchema).default([]),
  correlation: infrastructureCorrelationMetadataSchema.optional()
}).strict();
export type DeploymentHealthReport = z.output<typeof deploymentHealthReportSchema>;

export const dependencyHealthReportSchema = z.object({
  dependencyId: z.string().min(1),
  status: infrastructureHealthStatusSchema,
  checkedAt: z.string().datetime(),
  findings: z.array(infrastructureHealthFindingSchema).default([])
}).strict();
export type DependencyHealthReport = z.output<typeof dependencyHealthReportSchema>;

export const infrastructureHealthReportSchema = z.object({
  environmentId: z.string().min(1),
  deploymentId: z.string().min(1),
  status: infrastructureHealthStatusSchema,
  checkedAt: z.string().datetime(),
  deployment: deploymentHealthReportSchema,
  dependencies: z.array(dependencyHealthReportSchema).default([]),
  findings: z.array(infrastructureHealthFindingSchema).default([]),
  tenantIsolationVerified: z.literal(true),
  correlation: infrastructureCorrelationMetadataSchema.optional()
}).strict().refine((value) => value.deploymentId === value.deployment.deploymentId && value.environmentId === value.deployment.environmentId, {
  message: "Infrastructure report identity must match deployment report identity",
  path: ["deployment"]
});
export type InfrastructureHealthReport = z.output<typeof infrastructureHealthReportSchema>;

export const infrastructureHealthEvaluationInputSchema = z.object({
  environment: environmentDefinitionSchema,
  deployment: deploymentDefinitionSchema,
  serviceHealth: z.array(serviceHealthReportSchema).default([]),
  dependencyHealth: z.array(dependencyHealthReportSchema).default([]),
  checkedAt: z.string().datetime(),
  correlation: infrastructureCorrelationMetadataSchema.optional()
}).strict();
export type InfrastructureHealthEvaluationInput = z.output<typeof infrastructureHealthEvaluationInputSchema>;

const aggregateStatus = (statuses: readonly InfrastructureHealthStatus[]): InfrastructureHealthStatus => {
  if (statuses.includes("UNHEALTHY")) {
    return "UNHEALTHY";
  }
  if (statuses.includes("DEGRADED")) {
    return "DEGRADED";
  }
  if (statuses.includes("UNKNOWN")) {
    return "UNKNOWN";
  }
  return "HEALTHY";
};

export const validateEnvironment = (input: unknown, correlation?: InfrastructureCorrelationMetadata): EnvironmentDefinition =>
  parseInfrastructureSchema(environmentDefinitionSchema, input, "INFRASTRUCTURE_ENVIRONMENT_INVALID", "Environment definition validation failed", correlation);

export const validateInfrastructureDependencies = (input: unknown, serviceIds: readonly string[] = [], correlation?: InfrastructureCorrelationMetadata): readonly InfrastructureDependency[] => {
  const dependencies = parseInfrastructureSchema(z.array(infrastructureDependencySchema), input, "INFRASTRUCTURE_DEPENDENCY_INVALID", "Infrastructure dependency validation failed", correlation);
  const dependencyIds = dependencies.map((dependency) => dependency.id);
  if (hasDuplicate(dependencyIds)) {
    throw new InfrastructureRuntimeError({
      code: "INFRASTRUCTURE_DEPENDENCY_INVALID",
      message: "Infrastructure dependency IDs must be unique",
      status: 400,
      details: { duplicateIds: dependencyIds.filter((id, index) => dependencyIds.indexOf(id) !== index) },
      correlation
    });
  }

  const serviceIdSet = new Set(serviceIds);
  const dependencyIdSet = new Set(dependencyIds);
  const invalidServiceRefs = dependencies.flatMap((dependency) => missingReferences(dependency.serviceIds, serviceIdSet).map((serviceId) => `${dependency.id}:${serviceId}`));
  const invalidDependencyRefs = dependencies.flatMap((dependency) => missingReferences(dependency.dependsOn, dependencyIdSet).map((dependencyId) => `${dependency.id}:${dependencyId}`));
  if (invalidServiceRefs.length > 0 || invalidDependencyRefs.length > 0) {
    throw new InfrastructureRuntimeError({
      code: "INFRASTRUCTURE_DEPENDENCY_INVALID",
      message: "Infrastructure dependencies contain unresolved references",
      status: 400,
      details: { invalidServiceRefs, invalidDependencyRefs },
      correlation
    });
  }

  return dependencies;
};

export const validateSecretReferences = (input: unknown, serviceIds: readonly string[] = [], allowedTenantIds: readonly string[] = [], correlation?: InfrastructureCorrelationMetadata): readonly SecretReference[] => {
  const secrets = parseInfrastructureSchema(z.array(secretReferenceSchema), input, "INFRASTRUCTURE_SECRET_REFERENCE_INVALID", "Secret reference validation failed", correlation);
  const secretIds = secrets.map((secret) => secret.id);
  if (hasDuplicate(secretIds)) {
    throw new InfrastructureRuntimeError({
      code: "INFRASTRUCTURE_SECRET_REFERENCE_INVALID",
      message: "Secret reference IDs must be unique",
      status: 400,
      details: { duplicateIds: secretIds.filter((id, index) => secretIds.indexOf(id) !== index) },
      correlation
    });
  }

  const serviceIdSet = new Set(serviceIds);
  const allowedTenantIdSet = new Set(allowedTenantIds);
  const invalidServiceRefs = secrets.filter((secret) => secret.serviceId !== undefined && !serviceIdSet.has(secret.serviceId)).map((secret) => secret.id);
  const invalidTenantRefs = allowedTenantIds.length === 0 ? [] : secrets.filter((secret) => secret.tenantId !== undefined && !allowedTenantIdSet.has(secret.tenantId)).map((secret) => secret.id);
  if (invalidServiceRefs.length > 0 || invalidTenantRefs.length > 0) {
    throw new InfrastructureRuntimeError({
      code: "INFRASTRUCTURE_SECRET_REFERENCE_INVALID",
      message: "Secret references contain unresolved scope references",
      status: 400,
      details: { invalidServiceRefs, invalidTenantRefs },
      correlation
    });
  }

  return secrets;
};

export const validateDeployment = (input: unknown, environment?: EnvironmentDefinition, correlation?: InfrastructureCorrelationMetadata): DeploymentDefinition => {
  const deployment = parseInfrastructureSchema(deploymentDefinitionSchema, input, "INFRASTRUCTURE_DEPLOYMENT_INVALID", "Deployment definition validation failed", correlation);
  if (environment !== undefined && deployment.environmentId !== environment.id) {
    throw new InfrastructureRuntimeError({
      code: "INFRASTRUCTURE_DEPLOYMENT_INVALID",
      message: "Deployment environmentId must match environment definition",
      status: 400,
      details: { deploymentEnvironmentId: deployment.environmentId, environmentId: environment.id },
      correlation
    });
  }

  const serviceIds = deployment.services.map((service) => service.id);
  const serviceIdSet = new Set(serviceIds);
  const dependencyIds = deployment.dependencies.map((dependency) => dependency.id);
  const dependencyIdSet = new Set(dependencyIds);
  const secretIds = deployment.secretReferences.map((secret) => secret.id);
  const secretIdSet = new Set(secretIds);
  const configIds = deployment.configurationProviders.map((provider) => provider.id);
  const configIdSet = new Set(configIds);
  const backupIds = deployment.backupPolicies.map((policy) => policy.id);
  const backupIdSet = new Set(backupIds);
  const restoreIds = deployment.restorePolicies.map((policy) => policy.id);
  const restoreIdSet = new Set(restoreIds);

  const invalidServiceDependencies = deployment.services.flatMap((service) => missingReferences(service.dependsOn, serviceIdSet).map((serviceId) => `${service.id}:${serviceId}`));
  const invalidServiceSecrets = deployment.services.flatMap((service) => missingReferences(service.secretRefs, secretIdSet).map((secretId) => `${service.id}:${secretId}`));
  const invalidServiceConfigs = deployment.services.flatMap((service) => missingReferences(service.configurationRefs, configIdSet).map((configId) => `${service.id}:${configId}`));
  const invalidDependencyServices = deployment.dependencies.flatMap((dependency) => missingReferences(dependency.serviceIds, serviceIdSet).map((serviceId) => `${dependency.id}:${serviceId}`));
  const invalidDependencyRefs = deployment.dependencies.flatMap((dependency) => missingReferences(dependency.dependsOn, dependencyIdSet).map((dependencyId) => `${dependency.id}:${dependencyId}`));
  const invalidConfigSecrets = deployment.configurationProviders.flatMap((provider) => missingReferences(provider.secretRefs, secretIdSet).map((secretId) => `${provider.id}:${secretId}`));
  const invalidBackupDependencies = deployment.backupPolicies.flatMap((policy) => missingReferences(policy.targetDependencyIds, dependencyIdSet).map((dependencyId) => `${policy.id}:${dependencyId}`));
  const invalidRestoreBackups = deployment.restorePolicies.filter((policy) => !backupIdSet.has(policy.backupPolicyId)).map((policy) => policy.id);
  const invalidDrBackups = deployment.disasterRecoveryPolicies.flatMap((policy) => missingReferences(policy.backupPolicyIds, backupIdSet).map((backupId) => `${policy.id}:${backupId}`));
  const invalidDrRestores = deployment.disasterRecoveryPolicies.flatMap((policy) => missingReferences(policy.restorePolicyIds, restoreIdSet).map((restoreId) => `${policy.id}:${restoreId}`));

  const invalidReferences = {
    invalidServiceDependencies,
    invalidServiceSecrets,
    invalidServiceConfigs,
    invalidDependencyServices,
    invalidDependencyRefs,
    invalidConfigSecrets,
    invalidBackupDependencies,
    invalidRestoreBackups,
    invalidDrBackups,
    invalidDrRestores
  };
  if (Object.values(invalidReferences).some((values) => values.length > 0)) {
    throw new InfrastructureRuntimeError({
      code: "INFRASTRUCTURE_DEPLOYMENT_INVALID",
      message: "Deployment contains unresolved infrastructure references",
      status: 400,
      details: invalidReferences,
      correlation
    });
  }

  validateInfrastructureDependencies(deployment.dependencies, serviceIds, correlation);
  validateSecretReferences(deployment.secretReferences, serviceIds, environment?.tenantIsolation.allowedTenantIds ?? deployment.tenantIsolation.allowedTenantIds, correlation);
  return deployment;
};

export const evaluateInfrastructureHealth = (input: unknown): InfrastructureHealthReport => {
  const evaluation = parseInfrastructureSchema(infrastructureHealthEvaluationInputSchema, input, "INFRASTRUCTURE_HEALTH_INVALID", "Infrastructure health evaluation input validation failed");
  const deployment = validateDeployment(evaluation.deployment, evaluation.environment, evaluation.correlation);
  const serviceHealthById = new Map(evaluation.serviceHealth.map((health) => [health.serviceId, health]));
  const dependencyHealthById = new Map(evaluation.dependencyHealth.map((health) => [health.dependencyId, health]));

  const missingServiceHealthFindings = deployment.services
    .filter((service) => service.critical && !serviceHealthById.has(service.id))
    .map((service) => ({
      code: "SERVICE_HEALTH_MISSING",
      message: `Critical service ${service.id} has no health report`,
      severity: "CRITICAL" as const,
      targetId: service.id,
      tenantSafe: true as const
    }));

  const missingDependencyHealthFindings = deployment.dependencies
    .filter((dependency) => dependency.required && !dependencyHealthById.has(dependency.id))
    .map((dependency) => ({
      code: "DEPENDENCY_HEALTH_MISSING",
      message: `Required dependency ${dependency.id} has no health report`,
      severity: "CRITICAL" as const,
      targetId: dependency.id,
      tenantSafe: true as const
    }));

  const serviceReports = deployment.services.map((service) => serviceHealthById.get(service.id) ?? {
    serviceId: service.id,
    status: "UNKNOWN" as const,
    checkedAt: evaluation.checkedAt,
    findings: missingServiceHealthFindings.filter((finding) => finding.targetId === service.id)
  });
  const dependencyReports = deployment.dependencies.map((dependency) => dependencyHealthById.get(dependency.id) ?? {
    dependencyId: dependency.id,
    status: "UNKNOWN" as const,
    checkedAt: evaluation.checkedAt,
    findings: missingDependencyHealthFindings.filter((finding) => finding.targetId === dependency.id)
  });

  const deploymentStatus = aggregateStatus(serviceReports.map((report) => report.status));
  const infrastructureStatus = aggregateStatus([deploymentStatus, ...dependencyReports.map((report) => report.status)]);
  const findings = [...missingServiceHealthFindings, ...missingDependencyHealthFindings];
  const deploymentReport = deploymentHealthReportSchema.parse({
    deploymentId: deployment.id,
    environmentId: deployment.environmentId,
    status: deploymentStatus,
    checkedAt: evaluation.checkedAt,
    services: serviceReports,
    findings: missingServiceHealthFindings,
    correlation: evaluation.correlation
  });

  return infrastructureHealthReportSchema.parse({
    environmentId: evaluation.environment.id,
    deploymentId: deployment.id,
    status: infrastructureStatus,
    checkedAt: evaluation.checkedAt,
    deployment: deploymentReport,
    dependencies: dependencyReports,
    findings,
    tenantIsolationVerified: true,
    correlation: evaluation.correlation
  });
};
