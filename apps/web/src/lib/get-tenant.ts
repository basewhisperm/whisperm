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
