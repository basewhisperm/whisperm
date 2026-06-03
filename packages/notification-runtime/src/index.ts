import { z } from "zod";

export const trialReminderMarkerSchema = z.enum(["D-3", "D-1", "D+0"]);
export type TrialReminderMarker = z.output<typeof trialReminderMarkerSchema>;

export const tenantCreatedNotificationPayloadSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  workspaceName: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  ownerName: z.string().min(1).optional(),
  trialEndsAt: z.string().datetime().optional(),
}).strict();

export type TenantCreatedNotificationPayload = z.output<typeof tenantCreatedNotificationPayloadSchema>;

export const trialReminderJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1).optional(),
  trialEndsAt: z.string().datetime(),
  marker: trialReminderMarkerSchema,
}).strict();

export type TrialReminderJobPayload = z.output<typeof trialReminderJobPayloadSchema>;

export interface TrialReminderJob {
  readonly runAt: string;
  readonly dedupeKey: string;
  readonly payload: TrialReminderJobPayload;
}

export interface NotificationSchedulePort {
  scheduleTrialReminder(input: {
    readonly tenantId: string;
    readonly jobType: "notification.trial_reminder";
    readonly runAt: string;
    readonly dedupeKey: string;
    readonly payload: TrialReminderJobPayload;
  }): Promise<void> | void;
}

export interface NotificationServicePort {
  sendTrialExpiryEmail(input: {
    readonly workspace: {
      readonly tenantId: string;
      readonly workspaceId: string;
      readonly workspaceName: string;
    };
    readonly recipient: {
      readonly email: string;
      readonly name?: string | undefined;
    };
    readonly trialEndsAt: string;
    readonly marker: TrialReminderMarker;
  }): Promise<void> | void;
}

const subtractDays = (iso: string, days: number): string => {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

export const buildTrialReminderJobs = (input: TenantCreatedNotificationPayload): TrialReminderJob[] => {
  const payload = tenantCreatedNotificationPayloadSchema.parse(input);

  if (payload.ownerEmail === undefined || payload.trialEndsAt === undefined) {
    return [];
  }

  const workspaceId = payload.workspaceId ?? payload.tenantId;
  const workspaceName = payload.workspaceName ?? payload.slug ?? workspaceId;

  const base = {
    tenantId: payload.tenantId,
    workspaceId,
    workspaceName,
    recipientEmail: payload.ownerEmail,
    recipientName: payload.ownerName,
    trialEndsAt: payload.trialEndsAt,
  };

  return [
    {
      runAt: subtractDays(payload.trialEndsAt, 3),
      dedupeKey: `notification:trial-reminder:${payload.tenantId}:d-3`,
      payload: { ...base, marker: "D-3" },
    },
    {
      runAt: subtractDays(payload.trialEndsAt, 1),
      dedupeKey: `notification:trial-reminder:${payload.tenantId}:d-1`,
      payload: { ...base, marker: "D-1" },
    },
    {
      runAt: payload.trialEndsAt,
      dedupeKey: `notification:trial-reminder:${payload.tenantId}:d0`,
      payload: { ...base, marker: "D+0" },
    },
  ];
};

export const scheduleTrialReminderJobs = async (
  scheduler: NotificationSchedulePort,
  input: TenantCreatedNotificationPayload,
): Promise<number> => {
  const jobs = buildTrialReminderJobs(input);

  for (const job of jobs) {
    await scheduler.scheduleTrialReminder({
      tenantId: job.payload.tenantId,
      jobType: "notification.trial_reminder",
      runAt: job.runAt,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
    });
  }

  return jobs.length;
};

export const executeTrialReminderJob = async (
  notificationService: NotificationServicePort,
  input: TrialReminderJobPayload,
): Promise<void> => {
  const payload = trialReminderJobPayloadSchema.parse(input);

  await notificationService.sendTrialExpiryEmail({
    workspace: {
      tenantId: payload.tenantId,
      workspaceId: payload.workspaceId,
      workspaceName: payload.workspaceName,
    },
    recipient: {
      email: payload.recipientEmail,
      name: payload.recipientName,
    },
    trialEndsAt: payload.trialEndsAt,
    marker: payload.marker,
  });
};
