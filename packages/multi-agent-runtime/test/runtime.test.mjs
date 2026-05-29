import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MultiAgentRuntimeError,
  agentCapabilityContractSchema,
  agentRegistryContractSchema,
  approvalCheckpointIntegrationSchema,
  createApprovalCheckpointForDelegation,
  createBillingMeteringEvent,
  createDelegation,
  createTelemetryEvent,
  evaluateConsensus,
  parseMultiAgentContract,
  resolveConflictByPriority,
  transitionDelegation,
  validateCoordinationRuntime,
  validateExecutionGraph
} from "../dist/index.js";

const correlation = { correlationId: "corr-1", requestId: "req-1", traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" };
const now = "2026-05-29T12:00:00.000Z";

const plannerRole = {
  roleId: "planner",
  kind: "PLANNER",
  displayName: "Planner",
  allowedCapabilityKinds: ["DECOMPOSE_TASK", "PLAN_CAMPAIGN"],
  mayDelegate: true,
  mayApprove: false,
  maySupervise: false,
  replaySafe: true,
  metadata: {}
};

const workerRole = {
  roleId: "worker",
  kind: "WORKER",
  displayName: "Worker",
  allowedCapabilityKinds: ["EXECUTE_TASK"],
  mayDelegate: false,
  mayApprove: false,
  maySupervise: false,
  replaySafe: true,
  metadata: {}
};

const reviewerRole = {
  roleId: "reviewer",
  kind: "REVIEWER",
  displayName: "Reviewer",
  allowedCapabilityKinds: ["REVIEW_OUTPUT", "REQUEST_APPROVAL"],
  mayDelegate: false,
  mayApprove: true,
  maySupervise: false,
  replaySafe: true,
  metadata: {}
};

const executeCapability = {
  capabilityId: "execute.task",
  kind: "EXECUTE_TASK",
  version: 1,
  requiresApproval: false,
  tenantScoped: true,
  deterministic: true,
  replaySafe: true,
  runtimeMode: "DETERMINISTIC",
  metadata: {}
};

const registry = {
  tenantId: "tenant-1",
  registryId: "registry-1",
  version: 1,
  roles: [plannerRole, workerRole, reviewerRole],
  capabilities: [
    executeCapability,
    {
      capabilityId: "review.output",
      kind: "REVIEW_OUTPUT",
      version: 1,
      requiresApproval: true,
      tenantScoped: true,
      deterministic: true,
      replaySafe: true,
      runtimeMode: "DETERMINISTIC",
      metadata: {}
    }
  ],
  agents: [
    {
      tenantId: "tenant-1",
      agentId: "planner.agent",
      displayName: "Planner Agent",
      roleIds: ["planner"],
      capabilityIds: ["execute.task"],
      enabled: true,
      maxConcurrentDelegations: 5,
      supervisionRequired: false,
      createdAt: now,
      updatedAt: now,
      metadata: {}
    },
    {
      tenantId: "tenant-1",
      agentId: "worker.agent",
      displayName: "Worker Agent",
      roleIds: ["worker"],
      capabilityIds: ["execute.task"],
      enabled: true,
      maxConcurrentDelegations: 2,
      supervisionRequired: false,
      createdAt: now,
      updatedAt: now,
      metadata: {}
    },
    {
      tenantId: "tenant-1",
      agentId: "reviewer.agent",
      displayName: "Reviewer Agent",
      roleIds: ["reviewer"],
      capabilityIds: ["review.output"],
      enabled: true,
      maxConcurrentDelegations: 2,
      supervisionRequired: false,
      createdAt: now,
      updatedAt: now,
      metadata: {}
    }
  ],
  correlation,
  replaySafe: true
};

const context = {
  tenantId: "tenant-1",
  actorId: "actor-1",
  correlation,
  replay: { mode: "LIVE", deterministic: true }
};

const delegation = {
  tenantId: "tenant-1",
  delegationId: "delegation-1",
  fromAgentId: "planner.agent",
  toAgentId: "worker.agent",
  capabilityId: "execute.task",
  objective: "Execute deterministic task",
  input: { taskId: "task-1" },
  state: "REQUESTED",
  attempt: 1,
  requestedAt: now,
  idempotencyKey: "tenant-1:delegation-1:attempt-1",
  replaySafe: true,
  correlation,
  metadata: {}
};

test("registry contracts enforce tenant isolation and references", () => {
  const parsed = agentRegistryContractSchema.parse(registry);
  assert.equal(parsed.tenantId, "tenant-1");

  const mismatched = {
    ...registry,
    agents: [{ ...registry.agents[0], tenantId: "tenant-2" }, ...registry.agents.slice(1)]
  };
  assert.throws(() => agentRegistryContractSchema.parse(mismatched), /agent tenantId must match registry tenantId/);
});

test("provider-backed capability modes are rejected by runtime foundations", () => {
  assert.throws(
    () => agentCapabilityContractSchema.parse({ ...executeCapability, runtimeMode: "EXTERNAL_MODEL_BOUNDARY" }),
    /cannot bind live provider calls/
  );
});

test("createDelegation validates tenant and capability authorization", () => {
  const parsed = createDelegation({ context, registry, delegation });
  assert.equal(parsed.delegationId, "delegation-1");

  assert.throws(
    () => createDelegation({ context, registry, delegation: { ...delegation, tenantId: "tenant-2" } }),
    (error) => error instanceof MultiAgentRuntimeError && error.code === "MULTI_AGENT_TENANT_ISOLATION_VIOLATION"
  );

  assert.throws(
    () => createDelegation({ context, registry, delegation: { ...delegation, toAgentId: "reviewer.agent" } }),
    (error) => error instanceof MultiAgentRuntimeError && error.code === "MULTI_AGENT_CAPABILITY_NOT_ALLOWED"
  );
});

test("delegation state transitions are deterministic and typed", () => {
  const accepted = transitionDelegation(delegation, "ACCEPTED");
  assert.equal(accepted.state, "ACCEPTED");
  assert.throws(
    () => transitionDelegation(delegation, "COMPLETED"),
    (error) => error instanceof MultiAgentRuntimeError && error.code === "MULTI_AGENT_INVALID_STATE_TRANSITION"
  );
});

test("coordination runtime validates tenant scoped registry, team, and graph references", () => {
  const runtime = {
    tenant: context,
    registry,
    team: {
      tenantId: "tenant-1",
      teamId: "team-1",
      name: "Campaign Team",
      purpose: "Coordinate deterministic agent work",
      plannerAgentId: "planner.agent",
      workerAgentIds: ["worker.agent"],
      reviewerAgentIds: ["reviewer.agent"],
      allowedCapabilityIds: ["execute.task", "review.output"],
      maxParallelDelegations: 2,
      replaySafe: true,
      metadata: {}
    },
    graph: {
      tenantId: "tenant-1",
      graphId: "graph-runtime",
      version: 1,
      nodes: [{ nodeId: "plan", kind: "PLAN", tenantId: "tenant-1", replaySafe: true }],
      edges: [],
      entryNodeIds: ["plan"],
      terminalNodeIds: ["plan"],
      deterministic: true,
      replaySafe: true,
      correlation
    },
    approvalCheckpoints: [],
    replaySafe: true
  };
  assert.equal(validateCoordinationRuntime(runtime).team.teamId, "team-1");
  assert.throws(
    () => validateCoordinationRuntime({ ...runtime, team: { ...runtime.team, workerAgentIds: ["missing.agent"] } }),
    (error) => error instanceof MultiAgentRuntimeError
      && error.code === "MULTI_AGENT_VALIDATION_FAILED"
      && JSON.stringify(error.details).includes("team references unknown registry agent")
  );
});

test("execution graph validation rejects cycles for replay safety", () => {
  const graph = {
    tenantId: "tenant-1",
    graphId: "graph-1",
    version: 1,
    nodes: [
      { nodeId: "plan", kind: "PLAN", tenantId: "tenant-1", replaySafe: true },
      { nodeId: "work", kind: "DELEGATION", tenantId: "tenant-1", dependsOn: ["plan"], replaySafe: true }
    ],
    edges: [{ fromNodeId: "plan", toNodeId: "work", replaySafe: true }],
    entryNodeIds: ["plan"],
    terminalNodeIds: ["work"],
    deterministic: true,
    replaySafe: true,
    correlation
  };
  assert.equal(validateExecutionGraph(graph).graphId, "graph-1");

  const cyclic = { ...graph, edges: [...graph.edges, { fromNodeId: "work", toNodeId: "plan", replaySafe: true }] };
  assert.throws(
    () => validateExecutionGraph(cyclic),
    (error) => error instanceof MultiAgentRuntimeError && error.code === "MULTI_AGENT_INVALID_GRAPH"
  );
});

test("consensus evaluation supports majority and ignores foreign tenant votes", () => {
  const quorum = {
    tenantId: "tenant-1",
    quorumId: "quorum-1",
    strategy: "MAJORITY",
    voters: [
      { agentId: "planner.agent", weight: 1, required: false },
      { agentId: "worker.agent", weight: 1, required: false },
      { agentId: "reviewer.agent", weight: 1, required: false }
    ],
    approvalCheckpointRequired: false,
    replaySafe: true,
    correlation
  };
  const result = evaluateConsensus({
    quorum,
    votes: [
      { tenantId: "tenant-1", quorumId: "quorum-1", agentId: "planner.agent", vote: "APPROVE", votedAt: now, idempotencyKey: "v1", replaySafe: true, correlation },
      { tenantId: "tenant-1", quorumId: "quorum-1", agentId: "worker.agent", vote: "APPROVE", votedAt: now, idempotencyKey: "v2", replaySafe: true, correlation },
      { tenantId: "tenant-2", quorumId: "quorum-1", agentId: "reviewer.agent", vote: "REJECT", votedAt: now, idempotencyKey: "v3", replaySafe: true, correlation }
    ],
    evaluatedAt: now
  });
  assert.equal(result.outcome, "APPROVED");
  assert.equal(result.approvals, 2);
  assert.equal(result.rejections, 0);
});

test("conflicts can be resolved by deterministic priority", () => {
  const selected = resolveConflictByPriority({
    tenantId: "tenant-1",
    conflictId: "conflict-1",
    sourceAgentIds: ["worker.agent", "reviewer.agent"],
    description: "Choose deterministic candidate",
    candidateResolutionIds: ["candidate-a", "candidate-b"],
    strategy: "DETERMINISTIC_PRIORITY",
    deterministicPriority: ["candidate-b", "candidate-a"],
    replaySafe: true,
    correlation
  });
  assert.equal(selected, "candidate-b");
});

test("approval, billing, and telemetry integrations produce replay-safe contracts", () => {
  const checkpoint = createApprovalCheckpointForDelegation({
    delegation,
    checkpointId: "approval-1",
    requiredApproverAgentIds: ["reviewer.agent"],
    reason: "Review worker output before proceeding"
  });
  assert.equal(checkpoint.failClosed, true);
  assert.equal(checkpoint.idempotencyKey, "tenant-1:delegation-1:attempt-1:approval:approval-1");
  assert.equal(approvalCheckpointIntegrationSchema.parse(checkpoint).replaySafe, true);

  const metering = createBillingMeteringEvent({
    tenantId: "tenant-1",
    eventId: "usage-1",
    metric: "AGENT_DELEGATION",
    quantity: 1,
    occurredAt: now,
    sourceId: delegation.delegationId,
    idempotencyKey: delegation.idempotencyKey,
    correlation
  });
  assert.equal(metering.replaySafe, true);

  const telemetry = createTelemetryEvent({
    tenantId: "tenant-1",
    spanName: "multi_agent.delegate",
    operation: "DELEGATE",
    occurredAt: now,
    correlation,
    attributes: { "agent.delegation_id": delegation.delegationId }
  });
  assert.equal(telemetry.operation, "DELEGATE");
});

test("parseMultiAgentContract returns typed errors", () => {
  assert.throws(
    () => parseMultiAgentContract(agentRegistryContractSchema, { tenantId: "tenant-1" }, correlation),
    (error) => error instanceof MultiAgentRuntimeError && error.code === "MULTI_AGENT_VALIDATION_FAILED" && error.status === 400
  );
});
