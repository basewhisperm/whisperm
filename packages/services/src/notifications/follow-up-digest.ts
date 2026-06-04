import type { SendWeeklyIdleContactDigestInput } from "./notification-service.js";

export interface FollowUpDigestWorkspace {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly followUpReminderEnabled?: boolean | undefined;
  readonly alertDigestEnabled?: boolean | undefined;
}

export interface FollowUpDigestRecipient {
  readonly email: string;
  readonly name?: string | undefined;
}

export interface FollowUpDigestIdleContact {
  readonly id: string;
  readonly lastTouchAt?: string | Date | null | undefined;
}

export interface FollowUpDigestRepositoryPort {
  listWorkspacesForFollowUpDigest(): Promise<readonly FollowUpDigestWorkspace[]> | readonly FollowUpDigestWorkspace[];
  listOwnerAndAdminRecipients(context: { readonly tenantId: string }): Promise<readonly FollowUpDigestRecipient[]> | readonly FollowUpDigestRecipient[];
  listIdleContactsForFollowUpDigest(context: { readonly tenantId: string }, cutoff: Date): Promise<readonly FollowUpDigestIdleContact[]> | readonly FollowUpDigestIdleContact[];
}

export interface FollowUpDigestNotificationPort {
  sendWeeklyIdleContactDigest(input: SendWeeklyIdleContactDigestInput): Promise<"sent" | "suppressed"> | "sent" | "suppressed";
}

export interface WeeklyFollowUpDigestResult {
  readonly workspaceCount: number;
  readonly skippedWorkspaceCount: number;
  readonly digestCount: number;
}

const isFollowUpReminderEnabled = (workspace: FollowUpDigestWorkspace): boolean =>
  workspace.followUpReminderEnabled ?? workspace.alertDigestEnabled ?? true;

export const runWeeklyFollowUpDigest = async (
  repositories: FollowUpDigestRepositoryPort,
  notifications: FollowUpDigestNotificationPort,
  now: Date = new Date(),
): Promise<WeeklyFollowUpDigestResult> => {
  const workspaces = await repositories.listWorkspacesForFollowUpDigest();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let skippedWorkspaceCount = 0;
  let digestCount = 0;

  for (const workspace of workspaces) {
    if (!isFollowUpReminderEnabled(workspace)) {
      skippedWorkspaceCount += 1;
      continue;
    }

    const context = { tenantId: workspace.tenantId };
    const [idleContacts, recipients] = await Promise.all([
      repositories.listIdleContactsForFollowUpDigest(context, cutoff),
      repositories.listOwnerAndAdminRecipients(context),
    ]);

    if (idleContacts.length === 0 || recipients.length === 0) {
      continue;
    }

    for (const recipient of recipients) {
      const result = await notifications.sendWeeklyIdleContactDigest({
        workspace,
        recipient,
        idleContactCount: idleContacts.length,
        idleDays: 7,
      });
      if (result === "sent") digestCount += 1;
    }
  }

  return { workspaceCount: workspaces.length, skippedWorkspaceCount, digestCount };
};
