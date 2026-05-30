import { AuthError } from "./auth/errors.js";
import { EventIngestionError } from "./events/errors.js";

export type ApiErrorCode =
  | "API_KEY_MISSING"
  | "API_KEY_INVALID"
  | "HMAC_SIGNATURE_MISSING"
  | "HMAC_SIGNATURE_INVALID"
  | "TENANT_CONTEXT_MISMATCH"
  | "REQUEST_BODY_INVALID"
  | "READY_CHECK_FAILED"
  | "INTERNAL_SERVER_ERROR";

const statusByCode: Record<ApiErrorCode, number> = {
  API_KEY_MISSING: 401,
  API_KEY_INVALID: 401,
  HMAC_SIGNATURE_MISSING: 401,
  HMAC_SIGNATURE_INVALID: 401,
  TENANT_CONTEXT_MISMATCH: 403,
  REQUEST_BODY_INVALID: 400,
  READY_CHECK_FAILED: 503,
  INTERNAL_SERVER_ERROR: 500,
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
  if (error instanceof ApiError || error instanceof AuthError || error instanceof EventIngestionError) {
    return {
      statusCode: error.statusCode,
      payload: { ok: false, error: { code: error.code, message: error.message } },
    };
  }

  return {
    statusCode: 500,
    payload: {
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "An internal server error occurred" },
    },
  };
};
