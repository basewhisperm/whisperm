import type { NextResponse } from "next/server";
import { ServiceError } from "@whisperm/services";
import { PersistenceError } from "@whisperm/repositories";
import { apiFailure, type ApiErrorCode, type ApiFailure } from "./api-response";

// ST1-013N: single place mapping the service/repository layers' internal error codes onto the
// closed, stable ApiErrorCode set the V1 contract promises callers. Add a mapping here rather
// than inventing a new ad hoc code at a route call site.
const serviceCodeMap: Record<string, ApiErrorCode> = {
  SERVICE_VALIDATION_FAILED: "VALIDATION_ERROR",
  SERVICE_TENANT_MISMATCH: "TENANT_SCOPE_VIOLATION",
  SERVICE_NOT_FOUND: "NOT_FOUND",
  SERVICE_CONFLICT: "CONFLICT",
  SERVICE_INVALID_STATE_TRANSITION: "CONFLICT",
  SERVICE_IDEMPOTENCY_CONFLICT: "CONFLICT",
  SERVICE_PLAN_LIMIT_EXCEEDED: "FORBIDDEN",
  SERVICE_PROVIDER_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
};

const persistenceCodeMap: Record<string, ApiErrorCode> = {
  PERSISTENCE_TENANT_CONTEXT_MISSING: "TENANT_SCOPE_VIOLATION",
  PERSISTENCE_TENANT_MISMATCH: "TENANT_SCOPE_VIOLATION",
  PERSISTENCE_NOT_FOUND: "NOT_FOUND",
  PERSISTENCE_CONFLICT: "CONFLICT",
};

export function apiFailureFromError(error: unknown, fallbackMessage: string): NextResponse<ApiFailure> {
  if (error instanceof ServiceError) {
    return apiFailure(error.status, serviceCodeMap[error.code] ?? "INTERNAL_ERROR", error.message);
  }
  if (error instanceof PersistenceError) {
    return apiFailure(error.status, persistenceCodeMap[error.code] ?? "INTERNAL_ERROR", error.message);
  }
  return apiFailure(500, "INTERNAL_ERROR", fallbackMessage);
}
