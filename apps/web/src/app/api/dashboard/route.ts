import { NextResponse } from "next/server";

import { getDashboardDataForCurrentTenant, type DashboardLoadErrorCode } from "@/lib/dashboard-data";

// ST1-013H: thin read-model route -- getDashboardDataForCurrentTenant() is the
// only place that aggregates /dashboard data, shared with dashboard/page.tsx.
// This route never falls back to zeros on failure; it returns the typed error.
const STATUS_BY_ERROR_CODE: Readonly<Record<DashboardLoadErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  TENANT_REQUIRED: 401,
  FEATURE_DISABLED: 403,
  CONFIGURATION_ERROR: 503,
  UPSTREAM_ERROR: 502,
  UNKNOWN_ERROR: 500,
};

export async function GET() {
  const result = await getDashboardDataForCurrentTenant();

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: STATUS_BY_ERROR_CODE[result.error.code] });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
