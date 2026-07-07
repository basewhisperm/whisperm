import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import { provisionWorkspaceForUser } from "@/lib/billing/provision-workspace-for-user";

export async function getTenantForCurrentUser() {
  const context = await getTenantContextForCurrentUser();
  return context?.tenant ?? null;
}

const findTenantUserByEmails = (emails: string[]) =>
  prisma.tenantUser.findFirst({
    where: { email: { in: emails }, isActive: true },
    include: { tenant: true },
  });

export async function getTenantContextForCurrentUser() {
  const user = await currentUser();
  if (!user) return null;

  const emails = user.emailAddresses
    .map((email) => email.emailAddress.toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return null;

  const existing = await findTenantUserByEmails(emails);
  if (existing) return { tenant: existing.tenant, tenantUserId: existing.id };

  // First time this Clerk account has been seen: there is no self-service "create your
  // workspace" form today, so provision a trial workspace automatically rather than leaving
  // an authenticated user stuck looking at an empty, tenant-less app shell.
  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress.toLowerCase() ?? emails[0]!;
  await provisionWorkspaceForUser(user, primaryEmail);

  const provisioned = await findTenantUserByEmails(emails);
  if (!provisioned) return null;
  return { tenant: provisioned.tenant, tenantUserId: provisioned.id };
}
