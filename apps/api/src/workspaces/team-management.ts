import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { evaluateTeamMemberQuota, type BillingQuotaContext, type BillingQuotaPlan } from "../billing/quota.js";
import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";
import { assertRequiredRole } from "../auth/roles.js";
import { tenantRoles, type TenantRole } from "../auth/types.js";

const invitationTtlMs = 48 * 60 * 60 * 1000;
const acceptPathPrefix = "/invitations/";
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

interface RouteRequest extends FastifyRequestLike {
  readonly params?: Readonly<Record<string, string>> | undefined;
}

const isTenantRole = (value: unknown): value is TenantRole => typeof value === "string" && tenantRoles.includes(value as TenantRole);

const parseAssignableRole = (value: unknown): TenantRole => {
  if (!isTenantRole(value) || value === "OWNER") {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Role is invalid" });
  }
  return value;
};

const parseInviteBody = (body: unknown): { readonly email: string; readonly role: TenantRole } => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Invitation payload is invalid" });
  }
  const record = body as Readonly<Record<string, unknown>>;
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  if (!emailPattern.test(email)) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Invitation email is invalid" });
  }
  const role = record.role === undefined ? "MEMBER" : parseAssignableRole(record.role);
  return { email, role };
};

const parseRoleBody = (body: unknown): { readonly role: TenantRole } => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Role payload is invalid" });
  }
  return { role: parseAssignableRole((body as Readonly<Record<string, unknown>>).role) };
};

export interface WorkspaceMemberRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName?: string | null | undefined;
  readonly role: TenantRole;
  readonly isActive: boolean;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceInvitationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly role: TenantRole;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt?: string | null | undefined;
  readonly revokedAt?: string | null | undefined;
}

export interface TeamManagementStore {
  findWorkspace(input: { readonly tenantId: string }): Promise<WorkspaceRecord | null>;
  findMember(input: { readonly tenantId: string; readonly userId: string }): Promise<WorkspaceMemberRecord | null>;
  findMemberByEmail(input: { readonly tenantId: string; readonly email: string }): Promise<WorkspaceMemberRecord | null>;
  createMember(input: { readonly tenantId: string; readonly email: string; readonly role: TenantRole; readonly isActive: boolean }): Promise<WorkspaceMemberRecord>;
  updateMember(input: { readonly tenantId: string; readonly userId: string; readonly role?: TenantRole | undefined; readonly isActive?: boolean | undefined }): Promise<WorkspaceMemberRecord>;
  listMembers(input: { readonly tenantId: string }): Promise<readonly WorkspaceMemberRecord[]>;
  findCurrentPlan(input: { readonly tenantId: string; readonly correlationId: string }): Promise<BillingQuotaPlan | null>;
  createInvitation(input: Omit<WorkspaceInvitationRecord, "id">): Promise<WorkspaceInvitationRecord>;
  findInvitationByTokenHash(input: { readonly tokenHash: string }): Promise<WorkspaceInvitationRecord | null>;
  listPendingInvitations(input: { readonly tenantId: string; readonly now: Date }): Promise<readonly WorkspaceInvitationRecord[]>;
  markInvitationAccepted(input: { readonly tenantId: string; readonly invitationId: string; readonly acceptedAt: string }): Promise<WorkspaceInvitationRecord>;
  appendAudit(input: { readonly tenantId: string; readonly actorId?: string | undefined; readonly action: string; readonly targetType: string; readonly targetId?: string | undefined; readonly correlationId: string; readonly metadata?: Readonly<Record<string, unknown>> | undefined }): Promise<void>;
}

export interface TeamInviteMailer {
  sendTeamInviteEmail(input: {
    readonly workspace: { readonly tenantId: string; readonly workspaceId: string; readonly workspaceName: string };
    readonly recipient: { readonly email: string; readonly name?: string | undefined };
    readonly inviterName: string;
    readonly inviteUrl: string;
    readonly expiresAt: string;
  }): Promise<void>;
}

export interface WorkspaceTeamManagementDependencies {
  readonly store: TeamManagementStore;
  readonly mailer: TeamInviteMailer;
  readonly appBaseUrl: string;
  readonly now?: (() => Date) | undefined;
  readonly tokenFactory?: (() => string) | undefined;
}

export type WorkspaceTeamRouteName = "inviteCreate" | "inviteAccept" | "roleChange" | "memberRemove";

export const parseWorkspaceTeamRoute = (method: string, pathname: string): { readonly name: WorkspaceTeamRouteName; readonly params: Readonly<Record<string, string>> } | null => {
  const inviteCreate = /^\/workspaces\/([^/?#]+)\/invitations\/?$/u.exec(pathname);
  if (method === "POST" && inviteCreate !== null) return { name: "inviteCreate", params: { workspaceId: decodeURIComponent(inviteCreate[1] ?? "") } };
  const inviteAccept = /^\/invitations\/([^/?#]+)\/accept\/?$/u.exec(pathname);
  if (method === "POST" && inviteAccept !== null) return { name: "inviteAccept", params: { token: decodeURIComponent(inviteAccept[1] ?? "") } };
  const roleChange = /^\/workspaces\/([^/?#]+)\/members\/([^/?#]+)\/role\/?$/u.exec(pathname);
  if (method === "PATCH" && roleChange !== null) return { name: "roleChange", params: { workspaceId: decodeURIComponent(roleChange[1] ?? ""), userId: decodeURIComponent(roleChange[2] ?? "") } };
  const memberRemove = /^\/workspaces\/([^/?#]+)\/members\/([^/?#]+)\/?$/u.exec(pathname);
  if (method === "DELETE" && memberRemove !== null) return { name: "memberRemove", params: { workspaceId: decodeURIComponent(memberRemove[1] ?? ""), userId: decodeURIComponent(memberRemove[2] ?? "") } };
  return null;
};

const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

const tokenEquals = (expectedHash: string, token: string): boolean => {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const safeMember = (member: WorkspaceMemberRecord): Readonly<Record<string, unknown>> => ({
  id: member.id,
  tenantId: member.tenantId,
  email: member.email,
  displayName: member.displayName ?? undefined,
  role: member.role,
  isActive: member.isActive,
});

const requireWorkspaceAccess = async (store: TeamManagementStore, workspaceId: string, request: FastifyRequestLike): Promise<{ readonly tenantId: string; readonly actor: WorkspaceMemberRecord; readonly workspace: WorkspaceRecord }> => {
  const tenantId = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  const actorId = firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (tenantId === undefined || actorId === undefined || tenantId.length === 0 || actorId.length === 0 || workspaceId !== tenantId) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  const workspace = await store.findWorkspace({ tenantId });
  const actor = await store.findMember({ tenantId, userId: actorId });
  if (workspace === null || actor === null || !actor.isActive) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace membership is required" });
  }
  assertRequiredRole(actor.role, "ADMIN");
  return { tenantId, actor, workspace };
};

const buildInviteUrl = (baseUrl: string, token: string): string => `${baseUrl.replace(/\/+$/u, "")}${acceptPathPrefix}${encodeURIComponent(token)}/accept`;

const countSeatUsage = async (store: TeamManagementStore, tenantId: string, now: Date): Promise<number> => {
  const [members, pendingInvitations] = await Promise.all([
    store.listMembers({ tenantId }),
    store.listPendingInvitations({ tenantId, now }),
  ]);
  const activeMemberIds = new Set(members.filter((member) => member.isActive).map((member) => member.id));
  const pendingUserIds = new Set(pendingInvitations.filter((invitation) => invitation.acceptedAt == null && invitation.revokedAt == null && Date.parse(invitation.expiresAt) > now.getTime()).map((invitation) => invitation.userId));
  for (const id of activeMemberIds) pendingUserIds.delete(id);
  return activeMemberIds.size + pendingUserIds.size;
};

const enforceSeatQuota = async (store: TeamManagementStore, tenantId: string, correlationId: string, now: Date): Promise<void> => {
  const context: BillingQuotaContext = { tenantId, correlation: { correlationId } };
  const currentQuantity = await countSeatUsage(store, tenantId, now);
  const plan = await store.findCurrentPlan({ tenantId, correlationId });
  const decision = await evaluateTeamMemberQuota(plan ?? "STARTER", context, currentQuantity, now);
  if (!decision.allowed) {
    throw new ApiError({ code: "PLAN_LIMIT_EXCEEDED", message: "Team member seat limit exceeded", statusCode: 402, details: { limit: decision.limit } });
  }
};

const createInvitation = async (dependencies: WorkspaceTeamManagementDependencies, request: RouteRequest, reply: FastifyReplyLike): Promise<void> => {
  const workspaceId = request.params?.workspaceId ?? "";
  const { tenantId, actor, workspace } = await requireWorkspaceAccess(dependencies.store, workspaceId, request);
  const body = parseInviteBody(request.body);
  const now = dependencies.now?.() ?? new Date();
  await enforceSeatQuota(dependencies.store, tenantId, request.correlationId ?? request.id ?? "unknown", now);
  const member = await dependencies.store.findMemberByEmail({ tenantId, email: body.email })
    ?? await dependencies.store.createMember({ tenantId, email: body.email, role: body.role, isActive: false });
  const inactiveMember = member.isActive || member.role !== body.role
    ? await dependencies.store.updateMember({ tenantId, userId: member.id, role: body.role, isActive: false })
    : member;
  const token = dependencies.tokenFactory?.() ?? randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + invitationTtlMs).toISOString();
  const invitation = await dependencies.store.createInvitation({
    tenantId,
    userId: inactiveMember.id,
    email: inactiveMember.email,
    role: body.role,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt,
  });
  await dependencies.mailer.sendTeamInviteEmail({
    workspace: { tenantId, workspaceId: workspace.id, workspaceName: workspace.name },
    recipient: { email: inactiveMember.email, name: inactiveMember.displayName ?? undefined },
    inviterName: actor.displayName ?? actor.email,
    inviteUrl: buildInviteUrl(dependencies.appBaseUrl, token),
    expiresAt,
  });
  await dependencies.store.appendAudit({ tenantId, actorId: actor.id, action: "invitation.created", targetType: "INVITATION", targetId: invitation.id, correlationId: request.correlationId ?? request.id ?? "unknown", metadata: { userId: inactiveMember.id, email: inactiveMember.email, role: body.role, expiresAt } });
  reply.code(201).send({ ok: true, data: { id: invitation.id, workspaceId: tenantId, userId: inactiveMember.id, email: inactiveMember.email, role: body.role, expiresAt, status: "PENDING" }, meta: { correlationId: request.correlationId } });
};

const acceptInvitation = async (dependencies: WorkspaceTeamManagementDependencies, request: RouteRequest, reply: FastifyReplyLike): Promise<void> => {
  const token = request.params?.token ?? "";
  if (token.trim().length === 0) throw new ApiError({ code: "AUTH_INVALID_TOKEN", message: "Invitation token is required", statusCode: 401 });
  const invitation = await dependencies.store.findInvitationByTokenHash({ tokenHash: hashToken(token) });
  const now = dependencies.now?.() ?? new Date();
  if (invitation === null || !tokenEquals(invitation.tokenHash, token) || invitation.revokedAt != null || invitation.acceptedAt != null || Date.parse(invitation.expiresAt) <= now.getTime()) {
    throw new ApiError({ code: "AUTH_INVALID_TOKEN", message: "Invitation token is invalid or expired", statusCode: 401 });
  }
  const requestEmail = firstHeaderValue(request.headers, "x-user-email")?.trim().toLowerCase();
  if (requestEmail !== undefined && requestEmail.length > 0 && requestEmail !== invitation.email.toLowerCase()) {
    throw new ApiError({ code: "AUTH_INVALID_TOKEN", message: "Invitation token does not match authenticated email", statusCode: 401 });
  }
  const member = await dependencies.store.updateMember({ tenantId: invitation.tenantId, userId: invitation.userId, isActive: true, role: invitation.role });
  const accepted = await dependencies.store.markInvitationAccepted({ tenantId: invitation.tenantId, invitationId: invitation.id, acceptedAt: now.toISOString() });
  await dependencies.store.appendAudit({ tenantId: invitation.tenantId, actorId: member.id, action: "invitation.accepted", targetType: "INVITATION", targetId: accepted.id, correlationId: request.correlationId ?? request.id ?? "unknown", metadata: { userId: member.id, email: member.email, role: member.role } });
  const workspace = await dependencies.store.findWorkspace({ tenantId: invitation.tenantId });
  reply.send({ ok: true, data: { workspace: workspace ?? { id: invitation.tenantId, name: invitation.tenantId }, member: safeMember(member) }, meta: { correlationId: request.correlationId } });
};

const changeRole = async (dependencies: WorkspaceTeamManagementDependencies, request: RouteRequest, reply: FastifyReplyLike): Promise<void> => {
  const workspaceId = request.params?.workspaceId ?? "";
  const targetUserId = request.params?.userId ?? "";
  const { tenantId, actor } = await requireWorkspaceAccess(dependencies.store, workspaceId, request);
  const body = parseRoleBody(request.body);
  const target = await dependencies.store.findMember({ tenantId, userId: targetUserId });
  if (target === null) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Target member does not belong to workspace" });
  const member = await dependencies.store.updateMember({ tenantId, userId: targetUserId, role: body.role });
  await dependencies.store.appendAudit({ tenantId, actorId: actor.id, action: "member.role_changed", targetType: "TENANT_USER", targetId: member.id, correlationId: request.correlationId ?? request.id ?? "unknown", metadata: { previousRole: target.role, role: member.role } });
  reply.send({ ok: true, data: { member: safeMember(member) }, meta: { correlationId: request.correlationId } });
};

const removeMember = async (dependencies: WorkspaceTeamManagementDependencies, request: RouteRequest, reply: FastifyReplyLike): Promise<void> => {
  const workspaceId = request.params?.workspaceId ?? "";
  const targetUserId = request.params?.userId ?? "";
  const { tenantId, actor } = await requireWorkspaceAccess(dependencies.store, workspaceId, request);
  if (actor.id === targetUserId) throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "Cannot remove your own account", statusCode: 400 });
  const target = await dependencies.store.findMember({ tenantId, userId: targetUserId });
  if (target === null) throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Target member does not belong to workspace" });
  const member = await dependencies.store.updateMember({ tenantId, userId: targetUserId, isActive: false });
  await dependencies.store.appendAudit({ tenantId, actorId: actor.id, action: "member.removed", targetType: "TENANT_USER", targetId: member.id, correlationId: request.correlationId ?? request.id ?? "unknown", metadata: { email: target.email, role: target.role } });
  reply.send({ ok: true, data: { member: safeMember(member) }, meta: { correlationId: request.correlationId } });
};

export const createWorkspaceTeamManagementHandler = (dependencies: WorkspaceTeamManagementDependencies) => async (request: RouteRequest, reply: FastifyReplyLike): Promise<void> => {
  const routeName = request.params?.routeName as WorkspaceTeamRouteName | undefined;
  if (routeName === "inviteCreate") return createInvitation(dependencies, request, reply);
  if (routeName === "inviteAccept") return acceptInvitation(dependencies, request, reply);
  if (routeName === "roleChange") return changeRole(dependencies, request, reply);
  if (routeName === "memberRemove") return removeMember(dependencies, request, reply);
  throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace team route is invalid" });
};
