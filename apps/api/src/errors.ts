import { AuthError } from "./auth/errors.js";
import { OAuthError } from "./auth/oauth.js";
import { EventIngestionError } from "./events/errors.js";

export type ApiErrorCode =
  | "API_KEY_MISSING"
  | "API_KEY_INVALID"
  | "HMAC_SIGNATURE_MISSING"
  | "HMAC_SIGNATURE_INVALID"
  | "TENANT_CONTEXT_MISMATCH"
  | "REQUEST_BODY_INVALID"
  | "REQUEST_CONTENT_TYPE_INVALID"
  | "QUOTA_EXCEEDED"
  | "READY_CHECK_FAILED"
  | "INTERNAL_SERVER_ERROR"
  | "REPORTS_PLAN_REQUIRED"
  | "TRIAL_EXPIRED";

const statusByCode: Record<ApiErrorCode, number> = {
  API_KEY_MISSING: 401,
  API_KEY_INVALID: 401,
  HMAC_SIGNATURE_MISSING: 401,
  HMAC_SIGNATURE_INVALID: 401,
  TENANT_CONTEXT_MISMATCH: 403,
  REQUEST_BODY_INVALID: 400,
  REQUEST_CONTENT_TYPE_INVALID: 415,
  QUOTA_EXCEEDED: 402,
  READY_CHECK_FAILED: 503,
  INTERNAL_SERVER_ERROR: 500,
  REPORTS_PLAN_REQUIRED: 402,
  TRIAL_EXPIRED: 402,
};

export interface ApiErrorOptions {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly statusCode?: number;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;
  public readonly statusCode: number;
  public override readonly cause?: unknown;

  public constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = "ApiError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? statusByCode[options.code];
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface ErrorResponse {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly meta: {
    readonly correlationId: string;
  };
}

export const mapErrorToHttp = (error: unknown): { readonly statusCode: number; readonly payload: Omit<ErrorResponse, "meta"> } => {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "ZodError") {
    return { statusCode: 400, payload: { ok: false, error: { code: "REQUEST_BODY_INVALID", message: "Request payload is invalid" } } };
  }

  if (error instanceof ApiError || error instanceof AuthError || error instanceof EventIngestionError || error instanceof OAuthError) {
    return {
      statusCode: error.statusCode,
      payload: { ok: false, error: { code: error.code, message: error.message } },
    };
  }

  if (typeof error === "object" && error !== null && "status" in error && "code" in error && "message" in error) {
    const serviceError = error as { readonly status: unknown; readonly code: unknown; readonly message: unknown };
    if (typeof serviceError.status === "number" && typeof serviceError.code === "string" && typeof serviceError.message === "string") {
      return {
        statusCode: serviceError.status,
        payload: { ok: false, error: { code: serviceError.code, message: serviceError.message } },
      };
    }
  }

  return {
    statusCode: 500,
    payload: {
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "An internal server error occurred" },
    },
  };
};
