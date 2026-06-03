export interface WorkspaceEmailInput {
  readonly workspaceName: string;
  readonly recipientName?: string | undefined;
}

export interface TrialEmailInput extends WorkspaceEmailInput {
  readonly trialEndsAt: string;
}

export interface TeamInviteEmailInput extends WorkspaceEmailInput {
  readonly inviterName: string;
  readonly inviteUrl: string;
  readonly expiresAt: string;
}

export interface PipelineDigestInput extends WorkspaceEmailInput {
  readonly pipelineCount: number;
  readonly activeCampaignCount: number;
}

export interface IdleContactDigestInput extends WorkspaceEmailInput {
  readonly idleContactCount: number;
  readonly idleDays: number;
}

const greeting = (name?: string): string =>
  name === undefined || name.trim().length === 0 ? "Hello" : `Hello ${name}`;

export const welcomeEmail = (input: WorkspaceEmailInput) => ({
  subject: `Welcome to ${input.workspaceName}`,
  html: `<p>${greeting(input.recipientName)},</p><p>Welcome to ${input.workspaceName}. Your WhispeRM workspace is ready.</p>`,
});

export const trialExpiryEmail = (
  input: TrialEmailInput & { readonly marker: "D-3" | "D-1" | "D+0" },
) => ({
  subject:
    input.marker === "D+0"
      ? `Your ${input.workspaceName} trial expires today`
      : `Your ${input.workspaceName} trial ends soon`,
  html: `<p>${greeting(input.recipientName)},</p><p>Your WhispeRM trial for ${input.workspaceName} ${
    input.marker === "D+0" ? "expires today" : `ends on ${input.trialEndsAt}`
  }.</p>`,
});

export const teamInviteEmail = (input: TeamInviteEmailInput) => ({
  subject: `${input.inviterName} invited you to ${input.workspaceName}`,
  html: `<p>${greeting(input.recipientName)},</p><p>${input.inviterName} invited you to join ${input.workspaceName}.</p><p>This invitation expires at ${input.expiresAt}.</p><p><a href="${input.inviteUrl}">Accept invitation</a></p>`,
});

export const monthlyPipelineDigestEmail = (input: PipelineDigestInput) => ({
  subject: `${input.workspaceName} monthly pipeline digest`,
  html: `<p>${greeting(input.recipientName)},</p><p>Your monthly pipeline digest is ready.</p><p>Pipelines: ${input.pipelineCount}</p><p>Active campaigns: ${input.activeCampaignCount}</p>`,
});

export const weeklyIdleContactDigestEmail = (input: IdleContactDigestInput) => ({
  subject: `${input.workspaceName} weekly follow-up digest`,
  html: `<p>${greeting(input.recipientName)},</p><p>You have ${input.idleContactCount} contacts idle for ${input.idleDays}+ days.</p>`,
});
