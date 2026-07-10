import { NextResponse } from "next/server";
import type { CampaignRuntimeExecutionRecord } from "@whisperm/repositories";
import { resolveExecutionChannel } from "@whisperm/services";

// ST-003: maps a runtime execution record onto an honest JSON envelope so a route
// response never claims success for work that was merely queued. COMPLETED means the
// invitation was actually created/sent; PENDING means it is genuinely still in flight
// (queued/retry-scheduled); FAILED means delivery did not happen.
const httpStatusForFailureCode = (code: string | null | undefined): number => {
  if (code === "SERVICE_VALIDATION_FAILED" || code === "SERVICE_INVALID_STATE_TRANSITION") return 422;
  if (code === "SERVICE_NOT_FOUND") return 404;
  if (code === "SERVICE_PROVIDER_UNAVAILABLE") return 503;
  return 502;
};

export const invitationExecutionResponse = (execution: CampaignRuntimeExecutionRecord): NextResponse => {
  const metrics = execution.metrics ?? {};
  const invitationId = typeof metrics.invitationId === "string" ? metrics.invitationId : null;
  const channel = resolveExecutionChannel(metrics);

  if (execution.status === "COMPLETED") {
    return NextResponse.json({ ok: true, data: { executionId: execution.id, status: "COMPLETED", invitationId, channel } }, { status: 200 });
  }
  if (execution.status === "FAILED") {
    return NextResponse.json(
      { ok: false, error: { message: execution.errorMessage ?? "Seller invitation delivery failed", code: execution.errorCode ?? "INVITATION_DELIVERY_FAILED" } },
      { status: httpStatusForFailureCode(execution.errorCode) },
    );
  }
  // QUEUED / RUNNING: dispatch is still genuinely in flight (queued for a worker, or a
  // transient failure scheduled a retry) -- never claim this is done.
  return NextResponse.json({ ok: true, data: { executionId: execution.id, status: "PENDING", invitationId, channel } }, { status: 202 });
};
