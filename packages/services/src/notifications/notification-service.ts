import type { EmailProvider } from "@whisperm/provider-adapters";

import {
  monthlyPipelineDigestEmail,
  teamInviteEmail,
  trialExpiryEmail,
  weeklyIdleContactDigestEmail,
  welcomeEmail,
  type IdleContactDigestInput,
  type PipelineDigestInput,
  type TeamInviteEmailInput,
  type TrialEmailInput,
  type WorkspaceEmailInput,
} from "./email-templates.js";

export interface NotificationRecipient {
  readonly email: string;
  readonly name?: string | undefined;
}

export interface WorkspaceNotificationContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly alertDigestEnabled?: boolean | undefined;
}

export interface SendWorkspaceEmailInput {
  readonly workspace: WorkspaceNotificationContext;
  readonly recipient: NotificationRecipient;
}

export interface SendTrialEmailInput extends SendWorkspaceEmailInput {
  readonly trialEndsAt: string;
  readonly marker: "D-3" | "D-1" | "D+0";
}

export interface SendTeamInviteInput extends SendWorkspaceEmailInput {
  readonly inviterName: string;
  readonly inviteUrl: string;
  readonly expiresAt: string;
}

export interface SendMonthlyPipelineDigestInput extends SendWorkspaceEmailInput {
  readonly pipelineCount: number;
  readonly activeCampaignCount: number;
}

export interface SendWeeklyIdleContactDigestInput extends SendWorkspaceEmailInput {
  readonly idleContactCount: number;
  readonly idleDays: number;
}

export class NotificationService {
  constructor(private readonly emailProvider: EmailProvider) {}

  async sendWelcomeEmail(input: SendWorkspaceEmailInput): Promise<void> {
    await this.send(input.recipient.email, welcomeEmail(this.workspaceInput(input)));
  }

  async sendTrialExpiryEmail(input: SendTrialEmailInput): Promise<void> {
    const templateInput: TrialEmailInput & { readonly marker: "D-3" | "D-1" | "D+0" } = {
      ...this.workspaceInput(input),
      trialEndsAt: input.trialEndsAt,
      marker: input.marker,
    };
    await this.send(input.recipient.email, trialExpiryEmail(templateInput));
  }

  async sendTeamInviteEmail(input: SendTeamInviteInput): Promise<void> {
    const templateInput: TeamInviteEmailInput = {
      ...this.workspaceInput(input),
      inviterName: input.inviterName,
      inviteUrl: input.inviteUrl,
      expiresAt: input.expiresAt,
    };
    await this.send(input.recipient.email, teamInviteEmail(templateInput));
  }

  async sendMonthlyPipelineDigest(input: SendMonthlyPipelineDigestInput): Promise<"sent" | "suppressed"> {
    if (input.workspace.alertDigestEnabled === false) return "suppressed";

    const templateInput: PipelineDigestInput = {
      ...this.workspaceInput(input),
      pipelineCount: input.pipelineCount,
      activeCampaignCount: input.activeCampaignCount,
    };
    await this.send(input.recipient.email, monthlyPipelineDigestEmail(templateInput));
    return "sent";
  }

  async sendWeeklyIdleContactDigest(input: SendWeeklyIdleContactDigestInput): Promise<"sent" | "suppressed"> {
    if (input.workspace.alertDigestEnabled === false) return "suppressed";

    const templateInput: IdleContactDigestInput = {
      ...this.workspaceInput(input),
      idleContactCount: input.idleContactCount,
      idleDays: input.idleDays,
    };
    await this.send(input.recipient.email, weeklyIdleContactDigestEmail(templateInput));
    return "sent";
  }

  private workspaceInput(input: SendWorkspaceEmailInput): WorkspaceEmailInput {
    return {
      workspaceName: input.workspace.workspaceName,
      recipientName: input.recipient.name,
    };
  }

  private async send(
    to: string,
    message: { readonly subject: string; readonly html: string },
  ): Promise<void> {
    await this.emailProvider.send({
      to,
      subject: message.subject,
      html: message.html,
    });
  }
}
