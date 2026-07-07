import { prisma } from "@/lib/prisma";
import type { NotificationSchedulePort } from "@whisperm/notification-runtime";

/**
 * Persists trial-reminder jobs as durable QueueJob rows. Nothing currently consumes this queue
 * (apps/worker's queue runtime is in-memory only -- a pre-existing, separately-tracked gap), so
 * this does not yet cause an email to be sent. It does correctly and durably record the intent,
 * which is strictly better than the previous state where no concrete NotificationSchedulePort
 * implementation existed at all.
 */
export const notificationScheduleAdapter: NotificationSchedulePort = {
  async scheduleTrialReminder(input) {
    await prisma.queueJob.upsert({
      where: { tenantId_queueName_jobKey: { tenantId: input.tenantId, queueName: "notification", jobKey: input.dedupeKey } },
      create: {
        tenantId: input.tenantId,
        queueName: "notification",
        jobName: input.jobType,
        jobKey: input.dedupeKey,
        payload: input.payload,
        scheduledAt: new Date(input.runAt),
        availableAt: new Date(input.runAt),
        correlationId: input.dedupeKey,
      },
      update: {},
    });
  },
};
