import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import { provisionWorkspaceForUser } from "@/lib/provision-tenant";

type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
 * Only verified email addresses are eligible to resolve or provision a
 * workspace -- an address a user has added but not yet confirmed must not
 * be usable to claim (or create) tenant access.
 */
function verifiedEmails(user: CurrentUser): string[] {
  return user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress.toLowerCase());
}

function findTenantUserForEmails(emails: readonly string[]) {
  if (emails.length === 0) return Promise.resolve(null);
  return prisma.tenantUser.findFirst({
    where: {
      email: { in: [...emails] },
      isActive: true,
    },
    // Deterministic tiebreak for the (rare) case where one email is an
    // active TenantUser in more than one tenant -- always the oldest.
    orderBy: { createdAt: "asc" },
    include: { tenant: true },
  });
}

/**
 * Resolves the workspace for the signed-in Clerk user, provisioning a new
 * one on first sign-in if no active TenantUser row exists yet for any of
 * their verified emails. This is currently the only path that turns a live
 * sign-up into a workspace -- every other tenant comes from a seed script.
 */
async function resolveOrProvisionTenantUser(user: CurrentUser) {
  const emails = verifiedEmails(user);

  const existing = await findTenantUserForEmails(emails);
  if (existing) return existing;
  if (emails.length === 0) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined;
  const provisioned = await provisionWorkspaceForUser({ email: emails[0]!, displayName });

  return prisma.tenantUser.findUnique({
    where: { id: provisioned.tenantUserId },
    include: { tenant: true },
  });
}

export async function getTenantForCurrentUser() {
  const context = await getTenantContextForCurrentUser();
  return context?.tenant ?? null;
}

export async function getTenantContextForCurrentUser() {
  const user = await currentUser();
  if (!user) return null;

  const tenantUser = await resolveOrProvisionTenantUser(user);
  if (!tenantUser) return null;

  return { tenant: tenantUser.tenant, tenantUserId: tenantUser.id };
}

export type TenantResolution =
  | { readonly ok: true; readonly tenant: NonNullable<Awaited<ReturnType<typeof getTenantContextForCurrentUser>>>["tenant"]; readonly tenantUserId: string }
  | { readonly ok: false; readonly code: "AUTH_REQUIRED" | "TENANT_REQUIRED" };

/**
 * Distinguishes "not signed in" from "signed in but no workspace" so callers
 * that need to render a truthful status (rather than a single opaque null)
 * can tell the two apart. Errors thrown by Clerk/Prisma are left to propagate
 * -- this only classifies the two well-defined "no tenant" outcomes.
 */
export async function resolveTenantForCurrentUser(): Promise<TenantResolution> {
  const user = await currentUser();
  if (!user) return { ok: false, code: "AUTH_REQUIRED" };

  const tenantUser = await resolveOrProvisionTenantUser(user);
  if (!tenantUser) return { ok: false, code: "TENANT_REQUIRED" };

  return { ok: true, tenant: tenantUser.tenant, tenantUserId: tenantUser.id };
}
