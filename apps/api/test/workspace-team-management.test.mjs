import assert from "node:assert/strict";
import test from "node:test";

import { createApiServer } from "../dist/index.js";

const now = new Date("2026-06-04T12:00:00.000Z");

const createStore = ({ plan = "GROWTH", actorRole = "ADMIN" } = {}) => {
  const members = new Map([
    ["owner", { id: "owner", tenantId: "tenant-1", email: "owner@example.com", displayName: "Olivia", role: "OWNER", isActive: true }],
    ["admin", { id: "admin", tenantId: "tenant-1", email: "admin@example.com", displayName: "Ada Admin", role: actorRole, isActive: true }],
    ["member", { id: "member", tenantId: "tenant-1", email: "member@example.com", role: "MEMBER", isActive: true }],
  ]);

  const invitations = new Map();
  const audits = [];

  return {
    members,
    invitations,
    audits,
    sent: [],
    store: {
      async findWorkspace({ tenantId }) {
        return tenantId === "tenant-1" ? { id: "tenant-1", name: "Acme Workspace" } : null;
      },
      async findMember({ tenantId, userId }) {
        const member = members.get(userId);
        return member?.tenantId === tenantId ? member : null;
      },
      async findMemberByEmail({ tenantId, email }) {
        return [...members.values()].find((member) => member.tenantId === tenantId && member.email === email) ?? null;
      },
      async createMember(input) {
        const id = `user-${members.size + 1}`;
        const member = { id, ...input };
        members.set(id, member);
        return member;
      },
      async updateMember(input) {
        const member = members.get(input.userId);
        assert.ok(member);
        const updated = {
          ...member,
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        };
        members.set(input.userId, updated);
        return updated;
      },
      async listMembers({ tenantId }) {
        return [...members.values()].filter((member) => member.tenantId === tenantId);
      },
      async findCurrentPlan() {
        return plan;
      },
      async createInvitation(input) {
        const invitation = { id: `invite-${invitations.size + 1}`, ...input };
        invitations.set(invitation.id, invitation);
        return invitation;
      },
      async findInvitationByTokenHash({ tokenHash }) {
        return [...invitations.values()].find((invitation) => invitation.tokenHash === tokenHash) ?? null;
      },
      async listPendingInvitations({ tenantId, now: currentTime }) {
        return [...invitations.values()].filter(
          (invitation) =>
            invitation.tenantId === tenantId &&
            invitation.acceptedAt == null &&
            invitation.revokedAt == null &&
            Date.parse(invitation.expiresAt) > currentTime.getTime(),
        );
      },
      async markInvitationAccepted({ invitationId, acceptedAt }) {
        const invitation = invitations.get(invitationId);
        assert.ok(invitation);
        const accepted = { ...invitation, acceptedAt };
        invitations.set(invitationId, accepted);
        return accepted;
      },
      async appendAudit(input) {
        audits.push(input);
      },
    },
  };
};

const createDependencies = (team) => ({
  now: () => now,
  createEventId: () => "event-1",
  apiKeyAuthenticator: {
    async authenticate(input) {
      return { tenantId: input.tenantId, apiKeyId: "key-1" };
    },
  },
  hmacVerifier: {
    async verify() {
      return true;
    },
  },
  idempotency: {
    async reserve() {
      return "reserved";
    },
    async markSucceeded() {},
    async markFailed() {},
  },
  persistence: {
    async persistInboundEvent() {},
  },
  queue: {
    async enqueueInboundEvent() {},
  },
  workspaceTeamManagement: {
    store: team.store,
    mailer: {
      async sendTeamInviteEmail(input) {
        team.sent.push(input);
      },
    },
    appBaseUrl: "https://app.example.com",
    now: () => now,
    tokenFactory: () => "fixed-token",
  },
});

const authHeaders = (overrides = {}) => ({
  "x-tenant-id": "tenant-1",
  "x-user-id": "admin",
  "x-correlation-id": "corr-1",
  ...overrides,
});

const createInvite = (server, headers = authHeaders()) =>
  server.inject({
    method: "POST",
    url: "/workspaces/tenant-1/invitations",
    headers,
    payload: { email: "Person@Example.com", role: "MEMBER" },
  });

test("workspace invitation creates inactive TenantUser, 48h token expiry, email, and audit without returning token", async () => {
  const team = createStore();
  const server = createApiServer(createDependencies(team));

  const response = await createInvite(server);
  const payload = response.json();

  assert.equal(response.statusCode, 201);
  assert.equal(payload.data.email, "person@example.com");
  assert.equal(payload.data.expiresAt, "2026-06-06T12:00:00.000Z");
  assert.equal(payload.data.token, undefined);
  assert.equal(team.members.get(payload.data.userId).isActive, false);
  assert.equal(team.sent.length, 1);
  assert.equal(team.sent[0].inviteUrl, "https://app.example.com/invitations/fixed-token/accept");
  assert.equal(team.audits.at(-1).action, "invitation.created");
  assert.equal(team.audits.at(-1).metadata.token, undefined);
});

test("non-admin cannot create invitations or change roles", async () => {
  const team = createStore({ actorRole: "MEMBER" });
  const server = createApiServer(createDependencies(team));

  const invite = await createInvite(server);
  const role = await server.inject({
    method: "PATCH",
    url: "/workspaces/tenant-1/members/member/role",
    headers: authHeaders(),
    payload: { role: "ADMIN" },
  });

  assert.equal(invite.statusCode, 403);
  assert.equal(role.statusCode, 403);
});

test("pending invite counts against Starter seat limit and returns PLAN_LIMIT_EXCEEDED", async () => {
  const team = createStore({ plan: "STARTER" });
  team.members.delete("admin");
  team.members.delete("member");

  const server = createApiServer(createDependencies(team));

  const response = await server.inject({
    method: "POST",
    url: "/workspaces/tenant-1/invitations",
    headers: authHeaders({ "x-user-id": "owner" }),
    payload: { email: "second@example.com", role: "MEMBER" },
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "PLAN_LIMIT_EXCEEDED");
});

test("Growth rejects sixth seat while Pro permits beyond Growth", async () => {
  const growth = createStore({ plan: "GROWTH" });
  growth.members.set("m4", { id: "m4", tenantId: "tenant-1", email: "m4@example.com", role: "MEMBER", isActive: true });
  growth.members.set("m5", { id: "m5", tenantId: "tenant-1", email: "m5@example.com", role: "MEMBER", isActive: true });

  const growthResponse = await createInvite(createApiServer(createDependencies(growth)));

  const pro = createStore({ plan: "PRO" });
  pro.members.set("m4", { id: "m4", tenantId: "tenant-1", email: "m4@example.com", role: "MEMBER", isActive: true });
  pro.members.set("m5", { id: "m5", tenantId: "tenant-1", email: "m5@example.com", role: "MEMBER", isActive: true });

  const proResponse = await createInvite(createApiServer(createDependencies(pro)));

  assert.equal(growthResponse.statusCode, 402);
  assert.equal(growthResponse.json().error.code, "PLAN_LIMIT_EXCEEDED");
  assert.equal(proResponse.statusCode, 201);
});

test("valid invitation accept activates member, audits acceptance, and prevents token reuse", async () => {
  const team = createStore();
  const server = createApiServer(createDependencies(team));
  const invite = await createInvite(server);
  const userId = invite.json().data.userId;

  const accepted = await server.inject({
    method: "POST",
    url: "/invitations/fixed-token/accept",
    headers: { "x-user-email": "person@example.com", "x-correlation-id": "corr-2" },
  });

  const reused = await server.inject({
    method: "POST",
    url: "/invitations/fixed-token/accept",
  });

  assert.equal(accepted.statusCode, 200);
  assert.equal(team.members.get(userId).isActive, true);
  assert.equal(team.audits.at(-1).action, "invitation.accepted");
  assert.equal(reused.statusCode, 401);
});

test("expired and invalid invitation tokens are rejected", async () => {
  const team = createStore();
  const server = createApiServer(createDependencies(team));
  await createInvite(server);

  const expiredServer = createApiServer({
    ...createDependencies(team),
    workspaceTeamManagement: {
      ...createDependencies(team).workspaceTeamManagement,
      now: () => new Date("2026-06-06T12:00:00.000Z"),
    },
  });

  const invalid = await server.inject({ method: "POST", url: "/invitations/not-real/accept" });
  const expired = await expiredServer.inject({ method: "POST", url: "/invitations/fixed-token/accept" });

  assert.equal(invalid.statusCode, 401);
  assert.equal(expired.statusCode, 401);
});

test("admin role change succeeds, audits, and rejects cross-workspace target", async () => {
  const team = createStore();
  const server = createApiServer(createDependencies(team));

  const response = await server.inject({
    method: "PATCH",
    url: "/workspaces/tenant-1/members/member/role",
    headers: authHeaders(),
    payload: { role: "ADMIN" },
  });

  const crossWorkspace = await server.inject({
    method: "PATCH",
    url: "/workspaces/tenant-1/members/missing/role",
    headers: authHeaders(),
    payload: { role: "ADMIN" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(team.members.get("member").role, "ADMIN");
  assert.equal(team.audits.at(-1).action, "member.role_changed");
  assert.equal(crossWorkspace.statusCode, 403);
});

test("admin soft-deletes members, audits removal, and cannot remove self", async () => {
  const team = createStore();
  const server = createApiServer(createDependencies(team));

  const removed = await server.inject({
    method: "DELETE",
    url: "/workspaces/tenant-1/members/member",
    headers: authHeaders(),
  });

  const self = await server.inject({
    method: "DELETE",
    url: "/workspaces/tenant-1/members/admin",
    headers: authHeaders(),
  });

  assert.equal(removed.statusCode, 200);
  assert.equal(team.members.has("member"), true);
  assert.equal(team.members.get("member").isActive, false);
  assert.equal(team.audits.at(-1).action, "member.removed");
  assert.equal(self.statusCode, 400);
});