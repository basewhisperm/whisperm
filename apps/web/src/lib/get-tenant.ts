import { currentUser } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";

export async function getTenantForCurrentUser() {
  const user = await currentUser();

  console.log(
    JSON.stringify({
      scope: "getTenantForCurrentUser",
      clerkUserId: user?.id ?? null,
      emails: user?.emailAddresses?.map((email) => email.emailAddress) ?? [],
    }),
  );

  if (!user) return null;

  const emails = user.emailAddresses.map((email) => email.emailAddress.toLowerCase()).filter(Boolean);
  if (emails.length === 0) return null;

  const tenantUser = await prisma.tenantUser.findFirst({
    where: { email: { in: emails } },
    include: { tenant: true },
  });

  console.log(
    JSON.stringify({
      scope: "getTenantForCurrentUser",
      matchedTenant: tenantUser?.tenantId ?? null,
      matchedEmail: tenantUser?.email ?? null,
    }),
  );

  return tenantUser?.tenant ?? null;
}
