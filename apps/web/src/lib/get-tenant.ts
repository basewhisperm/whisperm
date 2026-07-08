import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";

export async function getTenantForCurrentUser() {
  const context = await getTenantContextForCurrentUser();
  return context?.tenant ?? null;
}

export async function getTenantContextForCurrentUser() {
  const user = await currentUser();
  if (!user) return null;

  const emails = user.emailAddresses
    .map((email) => email.emailAddress.toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return null;

  const tenantUser = await prisma.tenantUser.findFirst({
    where: {
      email: { in: emails },
      isActive: true,
    },
    include: { tenant: true },
  });

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

  const emails = user.emailAddresses
    .map((email) => email.emailAddress.toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return { ok: false, code: "TENANT_REQUIRED" };

  const tenantUser = await prisma.tenantUser.findFirst({
    where: {
      email: { in: emails },
      isActive: true,
    },
    include: { tenant: true },
  });

  if (!tenantUser) return { ok: false, code: "TENANT_REQUIRED" };

  return { ok: true, tenant: tenantUser.tenant, tenantUserId: tenantUser.id };
}
