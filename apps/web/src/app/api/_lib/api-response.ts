import { NextResponse } from "next/server";

// ST1-013N: canonical response envelope for V1/demo-critical API routes. Every route migrated
// to this helper returns exactly one of these two shapes, so a client (UI, Playwright, another
// service) can branch on `ok` alone instead of guessing at ad hoc per-route error shapes.
// Never pass a raw Error, a stack trace, or a secret value into `apiFailure` -- `message` and
// `details` are serialized directly into the HTTP response body.

export type ApiSuccess<T> = {
  readonly ok: true;
  readonly data: T;
};

export type ApiFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
};

// Stable, contract-tested error codes for V1/demo-critical routes. Add new values here rather
// than inventing ad hoc strings at call sites, so callers (UI, e2e, contract tests) can rely on
// a closed set.
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TENANT_SCOPE_VIOLATION"
  | "CAMPAIGN_SCOPE_VIOLATION"
  | "SELLER_NOT_IN_CAMPAIGN"
  | "CAPTURE_ASSIGNMENT_FAILED"
  | "INVITATION_NOT_ELIGIBLE"
  | "INVITATION_CHANNEL_MISMATCH"
  | "QUEUE_JOB_FAILED"
  | "RUNTIME_UNAVAILABLE"
  | "FEATURE_NOT_ENABLED"
  | "INTERNAL_ERROR";

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function apiFailure(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      ok: false,
      error: details === undefined ? { code, message } : { code, message, details },
    },
    { status },
  );
}
