import { AuthError } from "./errors.js";
import { hasRequiredRole } from "./roles.js";
import { tenantRoles, type TenantRole } from "./types.js";

export const marketplaceAcquisitionPermissions = [
  "marketplace_acquisition.read",
  "marketplace_acquisition.capture",
  "marketplace_acquisition.invite",
  "marketplace_acquisition.verify",
  "marketplace_acquisition.convert",
  "marketplace_acquisition.configure",
] as const;

export type MarketplaceAcquisitionPermission = (typeof marketplaceAcquisitionPermissions)[number];
export type Permission = MarketplaceAcquisitionPermission;

export const permissionMinimumRoles: Readonly<Record<Permission, TenantRole>> = {
  "marketplace_acquisition.read": "MEMBER",
  "marketplace_acquisition.capture": "MEMBER",
  "marketplace_acquisition.invite": "MEMBER",
  "marketplace_acquisition.verify": "ADMIN",
  "marketplace_acquisition.convert": "ADMIN",
  "marketplace_acquisition.configure": "OWNER",
};

const isTenantRole = (role: string | undefined): role is TenantRole =>
  tenantRoles.some((tenantRole) => tenantRole === role);

const isPermission = (permission: string): permission is Permission =>
  Object.hasOwn(permissionMinimumRoles, permission);

export const hasPermission = (userRole: TenantRole | string | undefined, permission: Permission | string): boolean => {
  if (!isTenantRole(userRole) || !isPermission(permission)) {
    return false;
  }

  return hasRequiredRole(userRole, permissionMinimumRoles[permission]);
};

export const requirePermission = (userRole: TenantRole | string | undefined, permission: Permission | string): void => {
  if (!hasPermission(userRole, permission)) {
    throw new AuthError({
      code: "AUTH_FORBIDDEN",
      message: `Requires tenant permission ${permission}`,
      details: { permission },
    });
  }
};
