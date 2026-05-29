import { z } from "zod";

const isoDurationPattern = /^P(?=\d|T\d)(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u;

export const approvalCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();
export type ApprovalCorrelationMetadata = z.infer<typeof approvalCorrelationMetadataSchema>;

export const approvalMetadataSchema = z.record(z.string(), z.unknown());
export type ApprovalMetadata = z.infer<typeof approvalMetadataSchema>;

export const approvalActorSchema = z.object({
  actorId: z.string().min(1),
  actorType: z.enum(["USER", "SERVICE", "AI_AGENT"]),
  tenantId: z.string().min(1),
  roles: z.array(z.string().min(1)).default([]),
  delegatedByActorId: z.string().min(1).optional()
}).strict();
export type ApprovalActor = z.output<typeof approvalActorSchema>;

export const approvalResourceSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  label: z.string().min(1).optional(),
  metadata: approvalMetadataSchema.default({})
}).strict();
export type ApprovalResource = z.output<typeof approvalResourceSchema>;

export const approvalKindValues = [
  "CAMPAIGN",
  "PUBLISHING",
  "BILLING",
  "AI_AGENT",
  "GENERIC"
] as const;
export const approvalKindSchema = z.enum(approvalKindValues);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const approvalPriorityValues = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const approvalPrioritySchema = z.enum(approvalPriorityValues);
export type ApprovalPriority = z.infer<typeof approvalPrioritySchema>;

export const approvalDecisionOutcomeValues = ["APPROVED", "REJECTED"] as const;
export const approvalDecisionOutcomeSchema = z.enum(approvalDecisionOutcomeValues);
export type ApprovalDecisionOutcome = z.infer<typeof approvalDecisionOutcomeSchema>;

export const approvalStateValues = [
  "DRAFT",
  "REQUESTED",
  "PENDING",
  "ESCALATED",
  "DELEGATED",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED"
] as const;
export const approvalStateSchema = z.enum(approvalStateValues);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

export const terminalApprovalStateValues = ["APPROVED", "REJECTED", "CANCELLED"] as const satisfies readonly ApprovalState[];
export type TerminalApprovalState = (typeof terminalApprovalStateValues)[number];

const approvalStateTransitions: Readonly<Record<ApprovalState, readonly ApprovalState[]>> = {
  DRAFT: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["PENDING", "CANCELLED", "FAILED"],
  PENDING: ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "ESCALATED", "DELEGATED", "FAILED"],
  ESCALATED: ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "DELEGATED", "FAILED"],
  DELEGATED: ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "ESCALATED", "FAILED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: ["REQUESTED"],
  CANCELLED: [],
  FAILED: ["REQUESTED"]
};

export const isTerminalApprovalState = (state: ApprovalState): state is TerminalApprovalState =>
  terminalApprovalStateValues.includes(state as TerminalApprovalState);

export const canTransitionApprovalState = (from: ApprovalState, to: ApprovalState): boolean =>
  approvalStateTransitions[from].includes(to);

export const approvalExpirationPolicySchema = z.object({
  kind: z.enum(["NONE", "FIXED_DURATION", "ABSOLUTE_TIME"]),
  duration: z.string().regex(isoDurationPattern).optional(),
  expiresAt: z.string().datetime().optional(),
  failClosed: z.literal(true).default(true)
}).strict().superRefine((policy, ctx) => {
  if (policy.kind === "FIXED_DURATION" && policy.duration === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "FIXED_DURATION requires duration", path: ["duration"] });
  }
  if (policy.kind === "ABSOLUTE_TIME" && policy.expiresAt === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ABSOLUTE_TIME requires expiresAt", path: ["expiresAt"] });
  }
  if (policy.kind === "NONE" && (policy.duration !== undefined || policy.expiresAt !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "NONE expiration policies cannot include duration or expiresAt" });
  }
});
export type ApprovalExpirationPolicy = z.output<typeof approvalExpirationPolicySchema>;

export const approvalEscalationPolicySchema = z.object({
  enabled: z.boolean(),
  after: z.string().regex(isoDurationPattern).optional(),
  escalateToRole: z.string().min(1).optional(),
  escalateToActorIds: z.array(z.string().min(1)).default([]),
  maxEscalations: z.number().int().min(0).max(20).default(0),
  replaySafe: z.literal(true).default(true)
}).strict().superRefine((policy, ctx) => {
  if (policy.enabled && policy.after === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "enabled escalation policies require after", path: ["after"] });
  }
  if (policy.enabled && policy.escalateToRole === undefined && policy.escalateToActorIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "enabled escalation policies require a target" });
  }
});
export type ApprovalEscalationPolicy = z.output<typeof approvalEscalationPolicySchema>;

export const approvalRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(25),
  retryableStates: z.array(z.enum(["FAILED", "EXPIRED"])).default(["FAILED"]),
  delayMs: z.number().int().min(0).max(86_400_000),
  jitter: z.literal(false).default(false),
  replaySafe: z.literal(true).default(true)
}).strict();
export type ApprovalRetryPolicy = z.output<typeof approvalRetryPolicySchema>;

export const approvalDelegationContractSchema = z.object({
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  fromActorId: z.string().min(1),
  toActorId: z.string().min(1),
  reason: z.string().min(1),
  delegatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  correlation: approvalCorrelationMetadataSchema
}).strict().refine((delegation) => delegation.fromActorId !== delegation.toActorId, {
  message: "delegation must target a different actor",
  path: ["toActorId"]
});
export type ApprovalDelegationContract = z.output<typeof approvalDelegationContractSchema>;

export const approvalWorkflowContractSchema = z.object({
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().min(1),
  checkpointId: z.string().min(1),
  stageId: z.string().min(1).optional(),
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  deterministic: z.literal(true).default(true),
  replaySafe: z.literal(true).default(true)
}).strict();
export type ApprovalWorkflowContract = z.output<typeof approvalWorkflowContractSchema>;

export const approvalCheckpointContractSchema = z.object({
  checkpointId: z.string().min(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  workflow: approvalWorkflowContractSchema.optional(),
  requiredRoles: z.array(z.string().min(1)).default([]),
  requiredApproverIds: z.array(z.string().min(1)).default([]),
  quorum: z.number().int().min(1).optional(),
  state: approvalStateSchema,
  attempt: z.number().int().min(1),
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true)
}).strict().superRefine((checkpoint, ctx) => {
  if (checkpoint.workflow !== undefined && checkpoint.workflow.tenantId !== checkpoint.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workflow tenantId must match checkpoint tenantId", path: ["workflow", "tenantId"] });
  }
});
export type ApprovalCheckpointContract = z.output<typeof approvalCheckpointContractSchema>;

export const approvalRequestSchema = z.object({
  approvalId: z.string().min(1),
  tenantId: z.string().min(1),
  kind: approvalKindSchema,
  title: z.string().min(1).max(240),
  description: z.string().min(1).max(4000).optional(),
  requester: approvalActorSchema,
  resource: approvalResourceSchema,
  workflow: approvalWorkflowContractSchema.optional(),
  requiredRoles: z.array(z.string().min(1)).default([]),
  requiredApproverIds: z.array(z.string().min(1)).default([]),
  priority: approvalPrioritySchema.default("NORMAL"),
  state: approvalStateSchema.default("REQUESTED"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  correlation: approvalCorrelationMetadataSchema,
  metadata: approvalMetadataSchema.default({}),
  expirationPolicy: approvalExpirationPolicySchema.default({ kind: "NONE", failClosed: true }),
  escalationPolicy: approvalEscalationPolicySchema.default({ enabled: false, escalateToActorIds: [], maxEscalations: 0, replaySafe: true }),
  retryPolicy: approvalRetryPolicySchema.default({ maxAttempts: 1, retryableStates: ["FAILED"], delayMs: 0, jitter: false, replaySafe: true })
}).strict().superRefine((request, ctx) => {
  if (request.requester.tenantId !== request.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "requester tenantId must match approval tenantId", path: ["requester", "tenantId"] });
  }
  if (request.resource.tenantId !== request.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "resource tenantId must match approval tenantId", path: ["resource", "tenantId"] });
  }
  if (request.workflow !== undefined && request.workflow.tenantId !== request.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workflow tenantId must match approval tenantId", path: ["workflow", "tenantId"] });
  }
  if (request.requiredRoles.length === 0 && request.requiredApproverIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval request requires a role or explicit approver" });
  }
});
export type ApprovalRequest = z.output<typeof approvalRequestSchema>;

export const approvalDecisionSchema = z.object({
  decisionId: z.string().min(1),
  approvalId: z.string().min(1),
  tenantId: z.string().min(1),
  outcome: approvalDecisionOutcomeSchema,
  decidedBy: approvalActorSchema,
  decidedAt: z.string().datetime(),
  reason: z.string().min(1).max(4000).optional(),
  tokenId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  correlation: approvalCorrelationMetadataSchema,
  metadata: approvalMetadataSchema.default({}),
  replaySafe: z.literal(true).default(true)
}).strict().superRefine((decision, ctx) => {
  if (decision.decidedBy.tenantId !== decision.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decider tenantId must match decision tenantId", path: ["decidedBy", "tenantId"] });
  }
});
export type ApprovalDecision = z.output<typeof approvalDecisionSchema>;

export const approvalTokenPurposeSchema = z.enum(["DECIDE", "DELEGATE", "CANCEL"]);
export type ApprovalTokenPurpose = z.infer<typeof approvalTokenPurposeSchema>;

export const approvalTokenPayloadSchema = z.object({
  tokenId: z.string().min(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  actorId: z.string().min(1),
  purpose: approvalTokenPurposeSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(1),
  correlation: approvalCorrelationMetadataSchema
}).strict();
export type ApprovalTokenPayload = z.output<typeof approvalTokenPayloadSchema>;

export interface ApprovalTokenGenerator {
  generateToken(payload: ApprovalTokenPayload): Promise<string> | string;
}

export interface ApprovalTokenVerifier {
  verifyToken(token: string, expected: { readonly tenantId: string; readonly approvalId: string; readonly actorId?: string; readonly purpose: ApprovalTokenPurpose }): Promise<ApprovalTokenPayload> | ApprovalTokenPayload;
}

export const approvalAuditActionSchema = z.enum([
  "REQUESTED",
  "DECIDED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "ESCALATED",
  "DELEGATED",
  "RETRIED",
  "FAILED"
]);
export type ApprovalAuditAction = z.infer<typeof approvalAuditActionSchema>;

export const approvalAuditTrailEntrySchema = z.object({
  auditId: z.string().min(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  action: approvalAuditActionSchema,
  actorId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  target: approvalResourceSchema,
  correlation: approvalCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1),
  metadata: approvalMetadataSchema.default({}),
  replaySafe: z.literal(true).default(true)
}).strict().refine((entry) => entry.target.tenantId === entry.tenantId, {
  message: "audit target tenantId must match audit tenantId",
  path: ["target", "tenantId"]
});
export type ApprovalAuditTrailEntry = z.output<typeof approvalAuditTrailEntrySchema>;

export const approvalEventTypeValues = [
  "approval.requested",
  "approval.decision.recorded",
  "approval.approved",
  "approval.rejected",
  "approval.cancelled",
  "approval.expired",
  "approval.escalated",
  "approval.delegated",
  "approval.retry_scheduled",
  "approval.failed"
] as const;
export const approvalEventTypeSchema = z.enum(approvalEventTypeValues);
export type ApprovalEventType = z.infer<typeof approvalEventTypeSchema>;

export const approvalReplaySafeEventSchema = z.object({
  eventId: z.string().min(1),
  type: approvalEventTypeSchema,
  version: z.literal(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  sequence: z.number().int().min(1),
  correlation: approvalCorrelationMetadataSchema,
  payload: approvalMetadataSchema.default({}),
  replaySafe: z.literal(true)
}).strict();
export type ApprovalReplaySafeEvent = z.output<typeof approvalReplaySafeEventSchema>;

export const approvalNotificationChannelSchema = z.enum(["EMAIL", "SLACK", "TEAMS", "SMS", "MOBILE", "WEBHOOK", "IN_APP"]);
export type ApprovalNotificationChannel = z.infer<typeof approvalNotificationChannelSchema>;

export const approvalNotificationContractSchema = z.object({
  notificationId: z.string().min(1),
  tenantId: z.string().min(1),
  approvalId: z.string().min(1),
  channel: approvalNotificationChannelSchema,
  recipientActorId: z.string().min(1),
  template: z.string().min(1),
  payload: approvalMetadataSchema.default({}),
  correlation: approvalCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true).default(true)
}).strict();
export type ApprovalNotificationContract = z.output<typeof approvalNotificationContractSchema>;

export interface ApprovalClock {
  now(): Date;
}

export interface ApprovalIdFactory {
  createId(input: { readonly tenantId: string; readonly approvalId: string; readonly kind: string; readonly sequence: number }): string;
}

export interface ApprovalTelemetrySpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  setAttribute?(key: string, value: string | number | boolean): void;
  recordException?(error: ApprovalRuntimeError): void;
  end(status: "OK" | "ERROR"): void;
}

export interface ApprovalTelemetryHooks {
  startSpan?(name: string, attributes: Readonly<Record<string, string | number | boolean>>): ApprovalTelemetrySpan;
  recordEvent?(event: ApprovalReplaySafeEvent): void | Promise<void>;
  recordAudit?(entry: ApprovalAuditTrailEntry): void | Promise<void>;
  recordError?(input: { readonly error: ApprovalRuntimeError; readonly tenantId: string; readonly approvalId?: string; readonly correlation: ApprovalCorrelationMetadata }): void | Promise<void>;
}

export interface ApprovalResolver {
  resolveApproval(input: { readonly tenantId: string; readonly approvalId: string; readonly correlation: ApprovalCorrelationMetadata }): Promise<ApprovalRequest | undefined> | ApprovalRequest | undefined;
}

export interface ApprovalPolicyResolver {
  resolveExpirationPolicy(input: { readonly tenantId: string; readonly approvalId: string; readonly kind: ApprovalKind }): Promise<ApprovalExpirationPolicy> | ApprovalExpirationPolicy;
  resolveEscalationPolicy(input: { readonly tenantId: string; readonly approvalId: string; readonly kind: ApprovalKind }): Promise<ApprovalEscalationPolicy> | ApprovalEscalationPolicy;
}

export interface ApprovalSecurityGuard {
  assertCanRequest(input: { readonly request: ApprovalRequest }): void | Promise<void>;
  assertCanDecide(input: { readonly request: ApprovalRequest; readonly decision: ApprovalDecision }): void | Promise<void>;
  assertCanCancel(input: { readonly request: ApprovalRequest; readonly actor: ApprovalActor; readonly correlation: ApprovalCorrelationMetadata }): void | Promise<void>;
  assertCanDelegate(input: { readonly request: ApprovalRequest; readonly delegation: ApprovalDelegationContract }): void | Promise<void>;
}

export interface ApprovalNotificationPublisher {
  publish(notification: ApprovalNotificationContract): void | Promise<void>;
}

export interface ApprovalExecutionMiddlewareDependencies {
  readonly securityGuard?: ApprovalSecurityGuard;
  readonly telemetry?: ApprovalTelemetryHooks;
  readonly notificationPublisher?: ApprovalNotificationPublisher;
  readonly clock?: ApprovalClock;
  readonly idFactory?: ApprovalIdFactory;
}

export interface ApprovalTransitionResult {
  readonly approval: ApprovalRequest;
  readonly events: readonly ApprovalReplaySafeEvent[];
  readonly audit: readonly ApprovalAuditTrailEntry[];
  readonly notifications: readonly ApprovalNotificationContract[];
}

export class ApprovalRuntimeError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ApprovalMetadata | undefined;
  readonly correlation?: ApprovalCorrelationMetadata | undefined;

  constructor(input: { readonly code: string; readonly message: string; readonly status: number; readonly details?: ApprovalMetadata | undefined; readonly correlation?: ApprovalCorrelationMetadata | undefined }) {
    super(input.message);
    this.name = "ApprovalRuntimeError";
    this.code = input.code;
    this.status = input.status;
    if (input.details !== undefined) {
      this.details = input.details;
    }
    if (input.correlation !== undefined) {
      this.correlation = input.correlation;
    }
  }
}

const systemClock: ApprovalClock = { now: () => new Date() };

const deterministicIdFactory: ApprovalIdFactory = {
  createId(input) {
    return [input.tenantId, input.approvalId, input.kind, String(input.sequence)].join(":");
  }
};

const durationToMilliseconds = (duration: string): number => {
  const match = isoDurationPattern.exec(duration);
  if (match === null) {
    throw new ApprovalRuntimeError({ code: "APPROVAL_DURATION_INVALID", message: "Approval duration must be an ISO-8601 day/time duration", status: 400 });
  }
  const days = Number.parseInt(match[1] ?? "0", 10);
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  const seconds = Number.parseInt(match[4] ?? "0", 10);
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
};

const zodIssues = (error: z.ZodError): ApprovalMetadata => ({
  issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message, code: issue.code }))
});

const toApprovalRuntimeError = (error: unknown, correlation?: ApprovalCorrelationMetadata | undefined): ApprovalRuntimeError => {
  if (error instanceof ApprovalRuntimeError) {
    return error;
  }
  if (error instanceof z.ZodError) {
    return new ApprovalRuntimeError({ code: "APPROVAL_VALIDATION_FAILED", message: "Approval contract validation failed", status: 400, details: zodIssues(error), correlation });
  }
  return new ApprovalRuntimeError({ code: "APPROVAL_RUNTIME_FAILED", message: "Approval runtime execution failed", status: 500, correlation });
};

export const assertApprovalTenantIsolation = (input: { readonly tenantId: string; readonly request?: ApprovalRequest | undefined; readonly decision?: ApprovalDecision | undefined; readonly actor?: ApprovalActor | undefined; readonly delegation?: ApprovalDelegationContract | undefined; readonly correlation?: ApprovalCorrelationMetadata | undefined }): void => {
  if (input.tenantId.length === 0) {
    throw new ApprovalRuntimeError({ code: "APPROVAL_TENANT_CONTEXT_MISSING", message: "Approval tenant context is required", status: 403, correlation: input.correlation });
  }
  const tenantValues = [
    input.request?.tenantId,
    input.request?.requester.tenantId,
    input.request?.resource.tenantId,
    input.request?.workflow?.tenantId,
    input.decision?.tenantId,
    input.decision?.decidedBy.tenantId,
    input.actor?.tenantId,
    input.delegation?.tenantId
  ].filter((tenantId): tenantId is string => tenantId !== undefined);
  const mismatchedTenant = tenantValues.find((tenantId) => tenantId !== input.tenantId);
  if (mismatchedTenant !== undefined) {
    throw new ApprovalRuntimeError({
      code: "APPROVAL_TENANT_MISMATCH",
      message: "Approval tenant isolation violation",
      status: 403,
      details: { expectedTenantId: input.tenantId, actualTenantId: mismatchedTenant },
      correlation: input.correlation
    });
  }
};

export const assertApprovalStateTransition = (from: ApprovalState, to: ApprovalState, correlation?: ApprovalCorrelationMetadata | undefined): void => {
  if (!canTransitionApprovalState(from, to)) {
    throw new ApprovalRuntimeError({
      code: "APPROVAL_TRANSITION_INVALID",
      message: `Cannot transition approval from ${from} to ${to}`,
      status: 409,
      details: { from, to },
      correlation
    });
  }
};

export const calculateApprovalExpiration = (input: { readonly policy: ApprovalExpirationPolicy; readonly requestedAt: Date }): string | undefined => {
  const policy = approvalExpirationPolicySchema.parse(input.policy);
  if (policy.kind === "NONE") {
    return undefined;
  }
  if (policy.kind === "ABSOLUTE_TIME") {
    return policy.expiresAt;
  }
  if (policy.duration === undefined) {
    throw new ApprovalRuntimeError({ code: "APPROVAL_DURATION_INVALID", message: "Approval fixed duration policy requires duration", status: 400 });
  }
  return new Date(input.requestedAt.getTime() + durationToMilliseconds(policy.duration)).toISOString();
};

export const shouldExpireApproval = (input: { readonly approval: ApprovalRequest; readonly now: Date }): boolean => {
  const approval = approvalRequestSchema.parse(input.approval);
  return approval.expiresAt !== undefined && !isTerminalApprovalState(approval.state) && input.now.getTime() >= Date.parse(approval.expiresAt);
};

export const shouldRetryApproval = (input: { readonly approval: ApprovalRequest; readonly completedAttempts: number }): boolean => {
  const approval = approvalRequestSchema.parse(input.approval);
  if (!Number.isInteger(input.completedAttempts) || input.completedAttempts < 0) {
    throw new ApprovalRuntimeError({ code: "APPROVAL_RETRY_ATTEMPT_INVALID", message: "Completed attempts must be a non-negative integer", status: 400, correlation: approval.correlation });
  }
  return approval.retryPolicy.retryableStates.includes(approval.state as "FAILED" | "EXPIRED") && input.completedAttempts < approval.retryPolicy.maxAttempts;
};

export const createApprovalCheckpoint = (input: Omit<ApprovalCheckpointContract, "replaySafe"> & { readonly replaySafe?: true }): ApprovalCheckpointContract =>
  approvalCheckpointContractSchema.parse({ ...input, replaySafe: true });

export const createApprovalTokenPayload = (input: ApprovalTokenPayload): ApprovalTokenPayload =>
  approvalTokenPayloadSchema.parse(input);

const createEvent = (input: {
  readonly tenantId: string;
  readonly approvalId: string;
  readonly type: ApprovalEventType;
  readonly occurredAt: string;
  readonly correlation: ApprovalCorrelationMetadata;
  readonly idempotencyKey: string;
  readonly sequence: number;
  readonly payload?: ApprovalMetadata | undefined;
  readonly idFactory: ApprovalIdFactory;
}): ApprovalReplaySafeEvent => approvalReplaySafeEventSchema.parse({
  eventId: input.idFactory.createId({ tenantId: input.tenantId, approvalId: input.approvalId, kind: input.type, sequence: input.sequence }),
  type: input.type,
  version: 1,
  tenantId: input.tenantId,
  approvalId: input.approvalId,
  occurredAt: input.occurredAt,
  idempotencyKey: input.idempotencyKey,
  sequence: input.sequence,
  correlation: input.correlation,
  payload: input.payload ?? {},
  replaySafe: true
});

const createAudit = (input: {
  readonly tenantId: string;
  readonly approvalId: string;
  readonly action: ApprovalAuditAction;
  readonly actorId?: string | undefined;
  readonly occurredAt: string;
  readonly target: ApprovalResource;
  readonly correlation: ApprovalCorrelationMetadata;
  readonly idempotencyKey: string;
  readonly idFactory: ApprovalIdFactory;
  readonly sequence: number;
  readonly metadata?: ApprovalMetadata | undefined;
}): ApprovalAuditTrailEntry => {
  const base = {
    auditId: input.idFactory.createId({ tenantId: input.tenantId, approvalId: input.approvalId, kind: `audit.${input.action.toLowerCase()}`, sequence: input.sequence }),
    tenantId: input.tenantId,
    approvalId: input.approvalId,
    action: input.action,
    occurredAt: input.occurredAt,
    target: input.target,
    correlation: input.correlation,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
    replaySafe: true
  };
  return approvalAuditTrailEntrySchema.parse(input.actorId === undefined ? base : { ...base, actorId: input.actorId });
};

const createNotification = (input: {
  readonly tenantId: string;
  readonly approvalId: string;
  readonly recipientActorId: string;
  readonly correlation: ApprovalCorrelationMetadata;
  readonly idempotencyKey: string;
  readonly idFactory: ApprovalIdFactory;
  readonly sequence: number;
  readonly payload?: ApprovalMetadata;
}): ApprovalNotificationContract => approvalNotificationContractSchema.parse({
  notificationId: input.idFactory.createId({ tenantId: input.tenantId, approvalId: input.approvalId, kind: "notification.in_app", sequence: input.sequence }),
  tenantId: input.tenantId,
  approvalId: input.approvalId,
  channel: "IN_APP",
  recipientActorId: input.recipientActorId,
  template: "approval.requested",
  payload: input.payload ?? {},
  correlation: input.correlation,
  idempotencyKey: input.idempotencyKey,
  replaySafe: true
});

export const createApprovalExecutionMiddleware = (dependencies: ApprovalExecutionMiddlewareDependencies = {}) => {
  const clock = dependencies.clock ?? systemClock;
  const idFactory = dependencies.idFactory ?? deterministicIdFactory;

  const emit = async (result: ApprovalTransitionResult): Promise<void> => {
    await Promise.all(result.events.map(async (event) => dependencies.telemetry?.recordEvent?.(event)));
    await Promise.all(result.audit.map(async (entry) => dependencies.telemetry?.recordAudit?.(entry)));
    await Promise.all(result.notifications.map(async (notification) => dependencies.notificationPublisher?.publish(notification)));
  };

  const transition = async (input: { readonly request: ApprovalRequest; readonly to: ApprovalState; readonly action: ApprovalAuditAction; readonly actor?: ApprovalActor; readonly correlation: ApprovalCorrelationMetadata; readonly idempotencyKey: string; readonly eventType: ApprovalEventType; readonly payload?: ApprovalMetadata }): Promise<ApprovalTransitionResult> => {
    const parsedRequest = approvalRequestSchema.parse(input.request);
    assertApprovalTenantIsolation({ tenantId: parsedRequest.tenantId, request: parsedRequest, actor: input.actor, correlation: input.correlation });
    assertApprovalStateTransition(parsedRequest.state, input.to, input.correlation);
    const occurredAt = clock.now().toISOString();
    const approval = approvalRequestSchema.parse({ ...parsedRequest, state: input.to, updatedAt: occurredAt });
    const event = createEvent({ tenantId: approval.tenantId, approvalId: approval.approvalId, type: input.eventType, occurredAt, correlation: input.correlation, idempotencyKey: input.idempotencyKey, sequence: 1, payload: input.payload, idFactory });
    const audit = createAudit({ tenantId: approval.tenantId, approvalId: approval.approvalId, action: input.action, actorId: input.actor?.actorId, occurredAt, target: approval.resource, correlation: input.correlation, idempotencyKey: input.idempotencyKey, idFactory, sequence: 2, metadata: input.payload });
    const result = { approval, events: [event], audit: [audit], notifications: [] } satisfies ApprovalTransitionResult;
    await emit(result);
    return result;
  };

  return {
    async requestApproval(request: ApprovalRequest): Promise<ApprovalTransitionResult> {
      const span = dependencies.telemetry?.startSpan?.("approval.request", { "approval.tenant_id": request.tenantId, "approval.id": request.approvalId, "approval.kind": request.kind });
      try {
        const parsedRequest = approvalRequestSchema.parse(request);
        assertApprovalTenantIsolation({ tenantId: parsedRequest.tenantId, request: parsedRequest, correlation: parsedRequest.correlation });
        await dependencies.securityGuard?.assertCanRequest({ request: parsedRequest });
        assertApprovalStateTransition(parsedRequest.state, "PENDING", parsedRequest.correlation);
        const occurredAt = clock.now().toISOString();
        const approval = approvalRequestSchema.parse({ ...parsedRequest, state: "PENDING", updatedAt: occurredAt });
        const event = createEvent({ tenantId: approval.tenantId, approvalId: approval.approvalId, type: "approval.requested", occurredAt, correlation: approval.correlation, idempotencyKey: approval.idempotencyKey, sequence: 1, idFactory });
        const audit = createAudit({ tenantId: approval.tenantId, approvalId: approval.approvalId, action: "REQUESTED", actorId: approval.requester.actorId, occurredAt, target: approval.resource, correlation: approval.correlation, idempotencyKey: approval.idempotencyKey, idFactory, sequence: 2 });
        const recipients = approval.requiredApproverIds.length > 0 ? approval.requiredApproverIds : approval.requiredRoles.map((role) => `role:${role}`);
        const notifications = recipients.map((recipientActorId, index) => createNotification({ tenantId: approval.tenantId, approvalId: approval.approvalId, recipientActorId, correlation: approval.correlation, idempotencyKey: `${approval.idempotencyKey}:notify:${recipientActorId}`, idFactory, sequence: index + 3 }));
        const result = { approval, events: [event], audit: [audit], notifications } satisfies ApprovalTransitionResult;
        await emit(result);
        span?.end("OK");
        return result;
      } catch (error) {
        const runtimeError = toApprovalRuntimeError(error, request.correlation);
        span?.recordException?.(runtimeError);
        span?.end("ERROR");
        await dependencies.telemetry?.recordError?.({ error: runtimeError, tenantId: request.tenantId, approvalId: request.approvalId, correlation: request.correlation });
        throw runtimeError;
      }
    },

    async decideApproval(input: { readonly request: ApprovalRequest; readonly decision: ApprovalDecision }): Promise<ApprovalTransitionResult> {
      const span = dependencies.telemetry?.startSpan?.("approval.decide", { "approval.tenant_id": input.request.tenantId, "approval.id": input.request.approvalId, "approval.outcome": input.decision.outcome });
      try {
        const request = approvalRequestSchema.parse(input.request);
        const decision = approvalDecisionSchema.parse(input.decision);
        if (request.approvalId !== decision.approvalId) {
          throw new ApprovalRuntimeError({ code: "APPROVAL_DECISION_MISMATCH", message: "Approval decision approvalId must match request approvalId", status: 409, correlation: decision.correlation });
        }
        assertApprovalTenantIsolation({ tenantId: request.tenantId, request, decision, actor: decision.decidedBy, correlation: decision.correlation });
        await dependencies.securityGuard?.assertCanDecide({ request, decision });
        const to = decision.outcome === "APPROVED" ? "APPROVED" : "REJECTED";
        const result = await transition({
          request,
          to,
          action: decision.outcome === "APPROVED" ? "DECIDED" : "REJECTED",
          actor: decision.decidedBy,
          correlation: decision.correlation,
          idempotencyKey: decision.idempotencyKey,
          eventType: decision.outcome === "APPROVED" ? "approval.approved" : "approval.rejected",
          payload: { decisionId: decision.decisionId, outcome: decision.outcome }
        });
        span?.end("OK");
        return result;
      } catch (error) {
        const runtimeError = toApprovalRuntimeError(error, input.decision.correlation);
        span?.recordException?.(runtimeError);
        span?.end("ERROR");
        await dependencies.telemetry?.recordError?.({ error: runtimeError, tenantId: input.request.tenantId, approvalId: input.request.approvalId, correlation: input.decision.correlation });
        throw runtimeError;
      }
    },

    async expireApproval(request: ApprovalRequest): Promise<ApprovalTransitionResult> {
      const parsedRequest = approvalRequestSchema.parse(request);
      if (!shouldExpireApproval({ approval: parsedRequest, now: clock.now() })) {
        throw new ApprovalRuntimeError({ code: "APPROVAL_NOT_EXPIRED", message: "Approval has not reached its expiration time", status: 409, correlation: parsedRequest.correlation });
      }
      return transition({ request: parsedRequest, to: "EXPIRED", action: "EXPIRED", correlation: parsedRequest.correlation, idempotencyKey: `${parsedRequest.idempotencyKey}:expire`, eventType: "approval.expired" });
    },

    async cancelApproval(input: { readonly request: ApprovalRequest; readonly actor: ApprovalActor; readonly reason: string; readonly correlation: ApprovalCorrelationMetadata }): Promise<ApprovalTransitionResult> {
      const request = approvalRequestSchema.parse(input.request);
      const actor = approvalActorSchema.parse(input.actor);
      assertApprovalTenantIsolation({ tenantId: request.tenantId, request, actor, correlation: input.correlation });
      await dependencies.securityGuard?.assertCanCancel({ request, actor, correlation: input.correlation });
      return transition({ request, to: "CANCELLED", action: "CANCELLED", actor, correlation: input.correlation, idempotencyKey: `${request.idempotencyKey}:cancel:${actor.actorId}`, eventType: "approval.cancelled", payload: { reason: input.reason } });
    },

    async retryApproval(input: { readonly request: ApprovalRequest; readonly completedAttempts: number }): Promise<ApprovalTransitionResult> {
      const request = approvalRequestSchema.parse(input.request);
      if (!shouldRetryApproval({ approval: request, completedAttempts: input.completedAttempts })) {
        throw new ApprovalRuntimeError({ code: "APPROVAL_RETRY_NOT_ALLOWED", message: "Approval retry is not allowed", status: 409, correlation: request.correlation });
      }
      return transition({ request, to: "REQUESTED", action: "RETRIED", correlation: request.correlation, idempotencyKey: `${request.idempotencyKey}:retry:${input.completedAttempts + 1}`, eventType: "approval.retry_scheduled", payload: { nextAttempt: input.completedAttempts + 1, delayMs: request.retryPolicy.delayMs } });
    },

    async delegateApproval(input: { readonly request: ApprovalRequest; readonly delegation: ApprovalDelegationContract }): Promise<ApprovalTransitionResult> {
      const request = approvalRequestSchema.parse(input.request);
      const delegation = approvalDelegationContractSchema.parse(input.delegation);
      assertApprovalTenantIsolation({ tenantId: request.tenantId, request, delegation, correlation: delegation.correlation });
      await dependencies.securityGuard?.assertCanDelegate({ request, delegation });
      return transition({ request, to: "DELEGATED", action: "DELEGATED", correlation: delegation.correlation, idempotencyKey: `${request.idempotencyKey}:delegate:${delegation.toActorId}`, eventType: "approval.delegated", payload: { fromActorId: delegation.fromActorId, toActorId: delegation.toActorId } });
    }
  };
};

export type ApprovalExecutionMiddleware = ReturnType<typeof createApprovalExecutionMiddleware>;

export const createDefaultApprovalSecurityGuard = (): ApprovalSecurityGuard => ({
  assertCanRequest(input) {
    assertApprovalTenantIsolation({ tenantId: input.request.tenantId, request: input.request, correlation: input.request.correlation });
  },
  assertCanDecide(input) {
    assertApprovalTenantIsolation({ tenantId: input.request.tenantId, request: input.request, decision: input.decision, actor: input.decision.decidedBy, correlation: input.decision.correlation });
    const roleAllowed = input.request.requiredRoles.some((role) => input.decision.decidedBy.roles.includes(role));
    const actorAllowed = input.request.requiredApproverIds.includes(input.decision.decidedBy.actorId);
    if (!roleAllowed && !actorAllowed) {
      throw new ApprovalRuntimeError({ code: "APPROVAL_DECIDER_FORBIDDEN", message: "Actor is not allowed to decide this approval", status: 403, correlation: input.decision.correlation });
    }
  },
  assertCanCancel(input) {
    assertApprovalTenantIsolation({ tenantId: input.request.tenantId, request: input.request, actor: input.actor, correlation: input.correlation });
    if (input.actor.actorId !== input.request.requester.actorId && !input.actor.roles.includes("ADMIN")) {
      throw new ApprovalRuntimeError({ code: "APPROVAL_CANCEL_FORBIDDEN", message: "Actor is not allowed to cancel this approval", status: 403, correlation: input.correlation });
    }
  },
  assertCanDelegate(input) {
    assertApprovalTenantIsolation({ tenantId: input.request.tenantId, request: input.request, delegation: input.delegation, correlation: input.delegation.correlation });
    const allowed = input.request.requiredApproverIds.includes(input.delegation.fromActorId);
    if (!allowed) {
      throw new ApprovalRuntimeError({ code: "APPROVAL_DELEGATION_FORBIDDEN", message: "Only explicitly assigned approvers may delegate approvals", status: 403, correlation: input.delegation.correlation });
    }
  }
});
