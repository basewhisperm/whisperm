/**
 * trial-init.ts — Workspace creation + trial initialization service.
 * Creates Subscription with status=TRIALING, schedules reminder emails.
 * No Stripe/Paystack customers created here.
 */
import { createTrialEndsAt } from "./trial.js";
import { scheduleTrialReminderJobs, type NotificationSchedulePort, type TenantCreatedNotificationPayload } from "@whisperm/notification-runtime";

export interface TrialSubscription {
  readonly tenantId: string;
  readonly status: "TRIALING";
  readonly trialEndsAt: string;
  readonly createdAt: string;
}
export interface WorkspaceTrialStore {
  createTrialSubscription(input: TrialSubscription): Promise<TrialSubscription>;
}
export interface InitTrialInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly ownerEmail: string;
  readonly ownerName?: string | undefined;
}
export interface InitTrialResult {
  readonly subscription: TrialSubscription;
  readonly reminderJobsScheduled: number;
}
export const initWorkspaceTrial = async (
  store: WorkspaceTrialStore,
  scheduler: NotificationSchedulePort,
  input: InitTrialInput,
  now: () => Date = () => new Date(),
): Promise<InitTrialResult> => {
  const evaluatedAt = now();
  const trialEndsAt = createTrialEndsAt(evaluatedAt);
  const subscription = await store.createTrialSubscription({
    tenantId: input.tenantId,
    status: "TRIALING",
    trialEndsAt: trialEndsAt.toISOString(),
    createdAt: evaluatedAt.toISOString(),
  });
  const notificationPayload: TenantCreatedNotificationPayload = {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    trialEndsAt: trialEndsAt.toISOString(),
  };
  const reminderJobsScheduled = await scheduleTrialReminderJobs(scheduler, notificationPayload);
  return { subscription, reminderJobsScheduled };
};
