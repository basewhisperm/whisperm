import type { AuthError } from "./errors.js";

// Mirrors prisma/schema.prisma enum TenantRole. Keep additions backward compatible.
export const tenantRoles = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type TenantRole = (typeof tenantRoles)[number];

export interface JwtAccessTokenClaims {
  subject: string;
  issuer?: string;
  audience?: string | readonly string[];
  expiresAt: Date;
  issuedAt?: Date;
  notBefore?: Date;
  tenantIds: readonly string[];
  raw: Readonly<Record<string, unknown>>;
}

export interface AuthenticatedPrincipal {
  userId: string;
  externalSubject: string;
  tenantIds: readonly string[];
  token: JwtAccessTokenClaims;
}

export interface TenantMembership {
  tenantId: string;
  userId: string;
  role: TenantRole;
  isActive: boolean;
  email?: string;
  displayName?: string;
}

export interface AuthenticatedRequestContext {
  principal: AuthenticatedPrincipal;
  membership?: TenantMembership;
}

export interface TenantMembershipLoader {
  loadMembership(input: {
    tenantId: string;
    userId: string;
    correlationId: string;
  }): Promise<TenantMembership | null>;
}

export interface RefreshTokenInput {
  refreshToken: string;
  correlationId: string;
}

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface RefreshTokenService {
  refresh(input: RefreshTokenInput): Promise<RefreshTokenResult>;
}

export interface AuditLogEntry {
  tenantId?: string;
  actorId?: string;
  action: string;
  target?: string;
  correlationId: string;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  reasonCode?: AuthError["code"];
  occurredAt: Date;
}

export interface AuditLogger {
  record(entry: AuditLogEntry): Promise<void>;
}

export const noopAuditLogger: AuditLogger = {
  async record(): Promise<void> {
    // Placeholder for durable audit sink; intentionally no-op until provider exists.
  },
};
