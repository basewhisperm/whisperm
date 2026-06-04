import { ApiError } from "../errors.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export const reportPeriods = ["this_month", "last_month", "quarter", "year"] as const;
export type ReportPeriod = typeof reportPeriods[number];
export type ReportPlan = "STARTER" | "GROWTH" | "PRO" | string;

export interface ReportRouteContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlation: {
    readonly correlationId: string;
  };
}

export interface ReportDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface ReportPeriodRange {
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface RevenueByStageItem {
  readonly stageId: string;
  readonly stageName: string;
  readonly revenue: number;
}

export interface ClientAcquisitionSourceItem {
  readonly source: string;
  readonly count: number;
}

export interface AverageDaysToCloseReport {
  readonly avgDaysToClose: number | null;
}

export interface RenewalRateReport {
  readonly rate: number | null;
}

export interface ReportsResponse {
  readonly period: ReportPeriod;
  readonly dateRange: ReportDateRange;
  readonly revenueByStage: readonly RevenueByStageItem[];
  readonly clientAcquisitionSources: readonly ClientAcquisitionSourceItem[];
  readonly averageDaysToClose: AverageDaysToCloseReport;
  readonly renewalRate: RenewalRateReport;
}

export interface ReportsReadModel {
  getCurrentPlan(context: { readonly tenantId: string }): Promise<{ readonly plan: ReportPlan } | null> | { readonly plan: ReportPlan } | null;
  revenueByStage(context: { readonly tenantId: string }, period: ReportPeriodRange): Promise<readonly RevenueByStageItem[]> | readonly RevenueByStageItem[];
  clientAcquisitionSources(context: { readonly tenantId: string }, period: ReportPeriodRange): Promise<readonly ClientAcquisitionSourceItem[]> | readonly ClientAcquisitionSourceItem[];
  averageDaysToClose(context: { readonly tenantId: string }, period: ReportPeriodRange): Promise<AverageDaysToCloseReport> | AverageDaysToCloseReport;
  renewalRate(context: { readonly tenantId: string }, period: ReportPeriodRange): Promise<RenewalRateReport> | RenewalRateReport;
}

export interface ReportsServicePort {
  get(context: ReportRouteContext, period: ReportPeriod): Promise<ReportsResponse> | ReportsResponse;
}

export interface ReportsRouteDependencies {
  readonly reports: ReportsServicePort;
}

type ReportsFastifyRequest = FastifyRequestLike & {
  readonly query?: Readonly<Record<string, string | undefined>> | undefined;
};

const supportedPeriodSet = new Set<string>(reportPeriods);

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

export const resolveReportPeriod = (period: ReportPeriod, now = new Date()): ReportPeriodRange => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (period === "this_month") {
    return {
      startDate: new Date(Date.UTC(year, month, 1)),
      endDate: new Date(Date.UTC(year, month + 1, 0)),
    };
  }

  if (period === "last_month") {
    return {
      startDate: new Date(Date.UTC(year, month - 1, 1)),
      endDate: new Date(Date.UTC(year, month, 0)),
    };
  }

  if (period === "quarter") {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    return {
      startDate: new Date(Date.UTC(year, quarterStartMonth, 1)),
      endDate: new Date(Date.UTC(year, quarterStartMonth + 3, 0)),
    };
  }

  return {
    startDate: new Date(Date.UTC(year, 0, 1)),
    endDate: new Date(Date.UTC(year, 12, 0)),
  };
};

const parseReportPeriod = (request: ReportsFastifyRequest): ReportPeriod => {
  const period = request.query?.period;
  if (period === undefined || !supportedPeriodSet.has(period)) {
    throw new ApiError({
      code: "REQUEST_BODY_INVALID",
      message: "Report period must be one of this_month, last_month, quarter, or year",
      statusCode: 400,
    });
  }
  return period as ReportPeriod;
};

const headerTenantId = (request: ReportsFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return value;
};

const actorId = (request: ReportsFastifyRequest): string => {
  const value = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Authenticated actor context is required", statusCode: 401 });
  }
  return value;
};

const routeContext = (request: ReportsFastifyRequest): ReportRouteContext => ({
  tenantId: headerTenantId(request),
  actorId: actorId(request),
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const sendSuccess = (reply: FastifyReplyLike, data: ReportsResponse, correlationId: string | undefined): void => {
  reply.header("cache-control", "no-store, no-cache, must-revalidate");
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

export const createReportsService = (readModel: ReportsReadModel, now: () => Date = () => new Date()): ReportsServicePort => ({
  async get(context, period) {
    const tenantScope = { tenantId: context.tenantId };
    const plan = await readModel.getCurrentPlan(tenantScope);
    if (plan?.plan === "STARTER") {
      throw new ApiError({ code: "REPORTS_PLAN_REQUIRED", message: "Reports require Growth or Pro plan", statusCode: 402 });
    }

    const dateRange = resolveReportPeriod(period, now());
    const exclusiveEndDate = new Date(Date.UTC(
      dateRange.endDate.getUTCFullYear(),
      dateRange.endDate.getUTCMonth(),
      dateRange.endDate.getUTCDate() + 1,
    ));
    const queryPeriod = { startDate: dateRange.startDate, endDate: exclusiveEndDate };
    const [revenueByStage, clientAcquisitionSources, averageDaysToClose, renewalRate] = await Promise.all([
      readModel.revenueByStage(tenantScope, queryPeriod),
      readModel.clientAcquisitionSources(tenantScope, queryPeriod),
      readModel.averageDaysToClose(tenantScope, queryPeriod),
      readModel.renewalRate(tenantScope, queryPeriod),
    ]);

    return {
      period,
      dateRange: {
        startDate: toIsoDate(dateRange.startDate),
        endDate: toIsoDate(dateRange.endDate),
      },
      revenueByStage,
      clientAcquisitionSources,
      averageDaysToClose,
      renewalRate,
    };
  },
});

export const createReportsHandler = (dependencies: ReportsRouteDependencies) => async (request: ReportsFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  sendSuccess(reply, await dependencies.reports.get(context, parseReportPeriod(request)), context.correlation.correlationId);
};
