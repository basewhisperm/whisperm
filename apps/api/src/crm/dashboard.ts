import { ApiError } from "../errors.js";
import { computeContactHealth, type ContactHealthStatus } from "./contact-health.js";
import { firstHeaderValue, type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export interface DashboardRouteContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlation: {
    readonly correlationId: string;
  };
}

export interface DashboardContactRecord {
  readonly id: string;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly company?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly lastTouchAt?: string | Date | null | undefined;
}

export interface DashboardActivityRecord {
  readonly id: string;
  readonly contactId?: string | null | undefined;
  readonly dealId?: string | null | undefined;
  readonly type: string;
  readonly note?: string | null | undefined;
  readonly createdById: string;
  readonly createdAt: string | Date;
}

export interface DashboardReadModel {
  countActiveContacts(context: { readonly tenantId: string }): Promise<number> | number;
  sumOpenPipelineValue(context: { readonly tenantId: string }): Promise<number> | number;
  sumWonValueForPeriod(context: { readonly tenantId: string }, period: { readonly from: Date; readonly to: Date }): Promise<number> | number;
  listContactsForHealth(context: { readonly tenantId: string }): Promise<readonly DashboardContactRecord[]> | readonly DashboardContactRecord[];
  listContactsForFollowUpAlerts?(context: { readonly tenantId: string }, cutoff: Date): Promise<readonly DashboardContactRecord[]> | readonly DashboardContactRecord[];
  getFollowUpReminderEnabled?(context: { readonly tenantId: string }): Promise<boolean> | boolean;
  listLatestActivities(context: { readonly tenantId: string }, limit: number): Promise<readonly DashboardActivityRecord[]> | readonly DashboardActivityRecord[];
}

export type DashboardHealthStatus = ContactHealthStatus;

export interface DashboardHealthPanelItem {
  readonly contactId: string;
  readonly name: string;
  readonly lastTouchAt: string | null;
  readonly daysSinceLastTouch: number | null;
  readonly status: DashboardHealthStatus;
  readonly fillPct: number;
}

export interface DashboardActivityFeedItem {
  readonly id: string;
  readonly contactId: string | null;
  readonly dealId: string | null;
  readonly type: string;
  readonly note: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface DashboardFollowUpAlert {
  readonly contactId: string;
  readonly name: string;
  readonly lastTouchAt: string | null;
  readonly daysSinceLastTouch: number | null;
}

export interface DashboardResponse {
  readonly metrics: {
    readonly activeClients: number;
    readonly pipelineValue: number;
    readonly wonsThisMonth: number;
    readonly avgResponseTimeDays: number | null;
  };
  readonly healthPanel: readonly DashboardHealthPanelItem[];
  readonly activityFeed: readonly DashboardActivityFeedItem[];
  readonly followUpAlerts: readonly DashboardFollowUpAlert[];
}

export interface DashboardServicePort {
  get(context: DashboardRouteContext): Promise<DashboardResponse> | DashboardResponse;
}

export interface DashboardRouteDependencies {
  readonly dashboard: DashboardServicePort;
}

type DashboardFastifyRequest = FastifyRequestLike & {
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
};

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value === undefined || value === null) return null;
  return value instanceof Date ? value : new Date(value);
};

const toIso = (value: string | Date | null | undefined): string | null => {
  const date = toDate(value);
  return date === null ? null : date.toISOString();
};

const startOfUtcMonth = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const startOfNextUtcMonth = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

const contactName = (contact: DashboardContactRecord): string => {
  const fullName = [contact.firstName, contact.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  if (fullName.length > 0) return fullName;
  for (const fallback of [contact.company, contact.email]) {
    if (typeof fallback === "string" && fallback.trim().length > 0) return fallback.trim();
  }
  return "Unknown contact";
};

const compareContactsByIdleFirst = (left: DashboardContactRecord, right: DashboardContactRecord): number => {
  const leftDate = toDate(left.lastTouchAt);
  const rightDate = toDate(right.lastTouchAt);
  if (leftDate === null && rightDate === null) return left.id.localeCompare(right.id);
  if (leftDate === null) return -1;
  if (rightDate === null) return 1;
  const delta = leftDate.getTime() - rightDate.getTime();
  return delta === 0 ? left.id.localeCompare(right.id) : delta;
};

const toHealthItem = (contact: DashboardContactRecord, now: Date): DashboardHealthPanelItem => ({
  contactId: contact.id,
  name: contactName(contact),
  lastTouchAt: toIso(contact.lastTouchAt),
  ...computeContactHealth(toDate(contact.lastTouchAt), now),
});

const toActivityFeedItem = (activity: DashboardActivityRecord): DashboardActivityFeedItem => ({
  id: activity.id,
  contactId: activity.contactId ?? null,
  dealId: activity.dealId ?? null,
  type: activity.type,
  note: activity.note ?? "",
  createdBy: activity.createdById,
  createdAt: toIso(activity.createdAt) ?? new Date(activity.createdAt).toISOString(),
});

const headerTenantId = (request: DashboardFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Workspace tenant context is required" });
  }
  return value;
};

const actorId = (request: DashboardFastifyRequest): string => {
  const value = request.auth?.principal.userId ?? firstHeaderValue(request.headers, "x-user-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Authenticated actor context is required", statusCode: 401 });
  }
  return value;
};

const routeContext = (request: DashboardFastifyRequest): DashboardRouteContext => ({
  tenantId: headerTenantId(request),
  actorId: actorId(request),
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string | undefined): void => {
  reply.header("cache-control", "no-store, no-cache, must-revalidate");
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

export const createDashboardService = (readModel: DashboardReadModel, now: () => Date = () => new Date()): DashboardServicePort => ({
  async get(context) {
    const currentTime = now();
    const tenantScope = { tenantId: context.tenantId };
    const followUpCutoff = new Date(currentTime.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [activeClients, pipelineValue, wonsThisMonth, contacts, activities, followUpReminderEnabled] = await Promise.all([
      readModel.countActiveContacts(tenantScope),
      readModel.sumOpenPipelineValue(tenantScope),
      readModel.sumWonValueForPeriod(tenantScope, { from: startOfUtcMonth(currentTime), to: startOfNextUtcMonth(currentTime) }),
      readModel.listContactsForHealth(tenantScope),
      readModel.listLatestActivities(tenantScope, 10),
      readModel.getFollowUpReminderEnabled?.(tenantScope) ?? true,
    ]);

    const sortedContacts = [...contacts].sort(compareContactsByIdleFirst);
    const healthPanel = sortedContacts.map((contact) => toHealthItem(contact, currentTime));
    const alertContacts = followUpReminderEnabled
      ? readModel.listContactsForFollowUpAlerts === undefined
        ? sortedContacts.filter((contact) => {
            const health = computeContactHealth(toDate(contact.lastTouchAt), currentTime);
            return health.daysSinceLastTouch === null || health.daysSinceLastTouch > 7;
          })
        : [...await readModel.listContactsForFollowUpAlerts(tenantScope, followUpCutoff)].sort(compareContactsByIdleFirst)
      : [];

    return {
      metrics: {
        activeClients,
        pipelineValue,
        wonsThisMonth,
        // TODO(S1.7): return a numeric value once a reliable response-time source is persisted.
        avgResponseTimeDays: null,
      },
      healthPanel,
      activityFeed: activities.map(toActivityFeedItem),
      followUpAlerts: alertContacts.map((contact) => {
        const health = computeContactHealth(toDate(contact.lastTouchAt), currentTime);
        return {
          contactId: contact.id,
          name: contactName(contact),
          lastTouchAt: toIso(contact.lastTouchAt),
          daysSinceLastTouch: health.daysSinceLastTouch,
        };
      }),
    };
  },
});

export const createDashboardHandler = (dependencies: DashboardRouteDependencies) => async (request: DashboardFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = routeContext(request);
  sendSuccess(reply, await dependencies.dashboard.get(context), context.correlation.correlationId);
};
