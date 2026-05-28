import { AuthError } from "./errors.js";
import type { TenantRole } from "./types.js";

export const roleRank: Readonly<Record<TenantRole, number>> = {
  OWNER: 40,
  ADMIN: 30,
  MEMBER: 20,
  VIEWER: 10,
};

export const hasRequiredRole = (actualRole: TenantRole, requiredRole: TenantRole): boolean =>
  roleRank[actualRole] >= roleRank[requiredRole];

export const assertRequiredRole = (actualRole: TenantRole | undefined, requiredRole: TenantRole): void => {
  if (actualRole === undefined || !hasRequiredRole(actualRole, requiredRole)) {
    throw new AuthError({
      code: "AUTH_FORBIDDEN",
      message: `Requires tenant role ${requiredRole} or higher`,
      details: { requiredRole },
    });
  }
};
