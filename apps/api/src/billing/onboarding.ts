/**
 * onboarding.ts — Onboarding checklist, computed live, never persisted.
 * Steps: import_contacts, setup_pipeline, invite_team_member.
 * No onboarding table. No checklist table.
 */
export interface OnboardingStatePort {
  countContacts(tenantId: string): Promise<number>;
  findDefaultPipelineWithStages(tenantId: string): Promise<{ stageCount: number } | null>;
  countTeamMembers(tenantId: string): Promise<number>;
  isMember(tenantId: string, userId: string): Promise<boolean>;
}

export type OnboardingStepKey = "import_contacts" | "setup_pipeline" | "invite_team_member";
export interface OnboardingStep { readonly complete: boolean; }
export interface OnboardingChecklist {
  readonly workspaceId: string;
  readonly steps: Readonly<Record<OnboardingStepKey, OnboardingStep>>;
  readonly percentComplete: number;
}

export const computeOnboardingChecklist = async (
  port: OnboardingStatePort,
  workspaceId: string,
  requestingUserId: string,
): Promise<OnboardingChecklist> => {
  const member = await port.isMember(workspaceId, requestingUserId);
  if (!member) {
    throw Object.assign(new Error("Not a member of this workspace"), { code: "ONBOARDING_ACCESS_DENIED", statusCode: 403 });
  }

  const [contactCount, pipeline, memberCount] = await Promise.all([
    port.countContacts(workspaceId),
    port.findDefaultPipelineWithStages(workspaceId),
    port.countTeamMembers(workspaceId),
  ]);

  const steps: Record<OnboardingStepKey, OnboardingStep> = {
    import_contacts:    { complete: contactCount >= 1 },
    setup_pipeline:     { complete: pipeline !== null && pipeline.stageCount > 0 },
    invite_team_member: { complete: memberCount > 1 },
  };

  const total = Object.keys(steps).length;
  const completed = Object.values(steps).filter((s) => s.complete).length;
  const percentComplete = Math.round((completed / total) * 100);

  return { workspaceId, steps, percentComplete };
};
