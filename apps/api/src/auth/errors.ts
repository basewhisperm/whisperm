export type AuthErrorCode =
  | "AUTH_MISSING_TOKEN"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_MEMBERSHIP_REQUIRED"
  | "AUTH_MEMBERSHIP_INACTIVE"
  | "AUTH_FORBIDDEN"
  | "TENANT_CONTEXT_REQUIRED"
  | "TENANT_CONTEXT_MISMATCH";

const defaultStatusByCode: Record<AuthErrorCode, number> = {
  AUTH_MISSING_TOKEN: 401,
  AUTH_INVALID_TOKEN: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_MEMBERSHIP_REQUIRED: 403,
  AUTH_MEMBERSHIP_INACTIVE: 403,
  AUTH_FORBIDDEN: 403,
  TENANT_CONTEXT_REQUIRED: 403,
  TENANT_CONTEXT_MISMATCH: 403,
};

export interface AuthErrorOptions {
  code: AuthErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
  statusCode?: number;
}

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;
  public readonly statusCode: number;

  public constructor(options: AuthErrorOptions) {
    super(options.message);
    this.name = "AuthError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? defaultStatusByCode[options.code];
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
