import { z } from "zod";
<<<<<<< HEAD

=======
>>>>>>> origin/main
export const trialReminderMarkerSchema = z.enum(["D-3", "D-1", "D+0"]);
export type TrialReminderMarker = z.output<typeof trialReminderMarkerSchema>;

export const tenantCreatedNotificationPayloadSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  workspaceName: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  ownerName: z.string().min(1).optional(),
<<<<<<< HEAD
  trialEndsAt: z.string().datetime().optional(),
=======
  trialEndsAt: z.string().datetime().optional()
>>>>>>> origin/main
}).strict();

export type TenantCreatedNotificationPayload = z.output<typeof tenantCreatedNotificationPayloadSchema>;

export const trialReminderJobPayloadSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1).optional(),
  trialEndsAt: z.string().datetime(),
<<<<<<< HEAD
  marker: trialReminderMarkerSchema,
=======
  marker: trialReminderMarkerSchema
>>>>>>> origin/main
}).strict();

export type TrialReminderJobPayload = z.output<typeof trialReminderJobPayloadSchema>;

<<<<<<< HEAD
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

=======
>>>>>>> origin/main
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

<<<<<<< HEAD
=======
export interface NotificationSchedulePort {
  scheduleTrialReminder(input: {
    readonly tenantId: string;
    readonly jobType: "notification.trial_reminder";
    readonly runAt: string;
    readonly dedupeKey: string;
    readonly payload: TrialReminderJobPayload;
  }): Promise<void> | void;
}

>>>>>>> origin/main
const subtractDays = (iso: string, days: number): string => {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

<<<<<<< HEAD
export const buildTrialReminderJobs = (input: TenantCreatedNotificationPayload): TrialReminderJob[] => {
=======
export const buildTrialReminderJobs = (
  input: TenantCreatedNotificationPayload,
): readonly {
  readonly runAt: string;
  readonly dedupeKey: string;
  readonly payload: TrialReminderJobPayload;
}[] => {
>>>>>>> origin/main
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
<<<<<<< HEAD
    trialEndsAt: payload.trialEndsAt,
  };
=======
    trialEndsAt: payload.trialEndsAt
  } satisfies Omit<TrialReminderJobPayload, "marker">;
>>>>>>> origin/main

  return [
    {
      runAt: subtractDays(payload.trialEndsAt, 3),
      dedupeKey: `notification:trial-reminder:${payload.tenantId}:d-3`,
<<<<<<< HEAD
      payload: { ...base, marker: "D-3" },
=======
      payload: { ...base, marker: "D-3" }
>>>>>>> origin/main
    },
    {
      runAt: subtractDays(payload.trialEndsAt, 1),
      dedupeKey: `notification:trial-reminder:${payload.tenantId}:d-1`,
<<<<<<< HEAD
      payload: { ...base, marker: "D-1" },
=======
      payload: { ...base, marker: "D-1" }
>>>>>>> origin/main
    },
    {
      runAt: payload.trialEndsAt,
      dedupeKey: `notification:trial-reminder:${payload.tenantId}:d0`,
<<<<<<< HEAD
      payload: { ...base, marker: "D+0" },
    },
=======
      payload: { ...base, marker: "D+0" }
    }
>>>>>>> origin/main
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
<<<<<<< HEAD
      payload: job.payload,
=======
      payload: job.payload
>>>>>>> origin/main
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
<<<<<<< HEAD
      workspaceName: payload.workspaceName,
    },
    recipient: {
      email: payload.recipientEmail,
      name: payload.recipientName,
    },
    trialEndsAt: payload.trialEndsAt,
    marker: payload.marker,
=======
      workspaceName: payload.workspaceName
    },
    recipient: {
      email: payload.recipientEmail,
      name: payload.recipientName
    },
    trialEndsAt: payload.trialEndsAt,
    marker: payload.marker
>>>>>>> origin/main
  });
};
