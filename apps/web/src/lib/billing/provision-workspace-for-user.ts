import type { User } from "@clerk/nextjs/server";
import { createWorkspace, initWorkspaceTrial } from "@whisperm/billing-runtime";

import { workspaceProvisioningPort } from "./workspace-provisioning-adapter";
import { trialStoreAdapter } from "./trial-store-adapter";
import { notificationScheduleAdapter } from "./notification-schedule-adapter";

const defaultFirmName = (user: Pick<User, "firstName" | "lastName" | "username">, email: string): string => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const owner = name.length > 0 ? name : (user.username ?? email.split("@")[0] ?? "New");
  return `${owner}'s Workspace`;
};

/**
 * Self-serve sign-up: called the moment a signed-in Clerk user has no TenantUser row yet.
 * Provisions a brand-new tenant + OWNER membership + default pipeline + 14-day trial
 * subscription, no payment step. There is no signup form collecting a firm name/country today,
 * so both are defaulted; the workspace can be renamed later once that UI exists.
 */
export const provisionWorkspaceForUser = async (
  user: Pick<User, "id" | "firstName" | "lastName" | "username">,
  email: string,
): Promise<{ readonly tenantId: string }> => {
  const firmName = defaultFirmName(user, email);
  const workspace = await createWorkspace(workspaceProvisioningPort, {
    userId: user.id,
    userEmail: email,
    userDisplayName: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined,
    firmName,
    country: "US",
  });

  await initWorkspaceTrial(trialStoreAdapter, notificationScheduleAdapter, {
    tenantId: workspace.workspaceId,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.name,
    ownerEmail: email,
  });

  return { tenantId: workspace.workspaceId };
};
