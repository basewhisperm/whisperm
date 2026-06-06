import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function getTenantForCurrentUser() {
  const user = await currentUser();
  if (!user) return null;

  const email = user.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  const tenantUser = await prisma.tenantUser.findFirst({
    where: { email: email.toLowerCase() },
    include: { tenant: true },
  });

  return tenantUser?.tenant ?? null;
}
