/**
 * workspace-provisioning.ts — WorkspaceProvisioningService
 * Provisions: Tenant, OWNER membership, default pipeline, trial subscription.
 * Idempotent: same slug returns existing workspace.
 * No Stripe/Paystack customers created here. No new dependencies.
 */
import { initWorkspaceTrial, type WorkspaceTrialStore, type InitTrialInput, type InitTrialResult } from "./trial-init.js";
import type { NotificationSchedulePort } from "@whisperm/notification-runtime";

const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  GH: "GHS", US: "USD", GB: "GBP", NG: "NGN", CA: "CAD", AU: "AUD",
};

export const currencyForCountry = (country: string): string =>
  COUNTRY_CURRENCY[country.toUpperCase()] ?? "USD";

export const generateWorkspaceSlug = (firmName: string): string =>
  firmName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "workspace";

export const DEFAULT_PIPELINE_STAGES = [
  { name: "Prospect",   position: 1, color: "#6B7280" },
  { name: "Qualified",  position: 2, color: "#3B82F6" },
  { name: "Proposal",   position: 3, color: "#8B5CF6" },
  { name: "Engagement", position: 4, color: "#F59E0B" },
  { name: "Renewal",    position: 5, color: "#10B981" },
] as const;

export interface CreatedTenant { readonly id: string; readonly slug: string; readonly name: string; }
export interface CreatedUser { readonly id: string; readonly tenantId: string; readonly role: "OWNER"; readonly email: string; }
export interface CreatedPipeline { readonly id: string; readonly tenantId: string; readonly name: string; readonly isDefault: boolean; readonly stageCount: number; }

export interface WorkspaceProvisioningPort {
  findTenantBySlug(slug: string): Promise<CreatedTenant | null>;
  createTenant(input: { slug: string; name: string; country: string; currency: string }): Promise<CreatedTenant>;
  createOwnerMembership(input: { tenantId: string; userId: string; email: string }): Promise<CreatedUser>;
  findDefaultPipeline(tenantId: string): Promise<CreatedPipeline | null>;
  createDefaultPipeline(input: { tenantId: string; name: string }): Promise<CreatedPipeline>;
  findTrialSubscription(tenantId: string): Promise<{ status: string } | null>;
}

export interface CreateWorkspaceInput {
  readonly userId: string;
  readonly userEmail: string;
  readonly userDisplayName?: string | undefined;
  readonly firmName: string;
  readonly country: string;
  readonly currency?: string | undefined;
  readonly industry?: string | undefined;
}

export interface CreateWorkspaceResult {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly currency: string;
  readonly country: string;
  readonly isNew: boolean;
  readonly subscription: InitTrialResult["subscription"] | { status: string };
  readonly pipeline: CreatedPipeline;
}

export const createWorkspace = async (
  port: WorkspaceProvisioningPort,
  trialStore: WorkspaceTrialStore,
  trialScheduler: NotificationSchedulePort,
  input: CreateWorkspaceInput,
  now: () => Date = () => new Date(),
): Promise<CreateWorkspaceResult> => {
  const slug = generateWorkspaceSlug(input.firmName);
  const currency = input.currency ?? currencyForCountry(input.country);

  const existingTenant = await port.findTenantBySlug(slug);
  if (existingTenant !== null) {
    const existingPipeline = await port.findDefaultPipeline(existingTenant.id);
    const existingSubscription = await port.findTrialSubscription(existingTenant.id);
    if (existingPipeline !== null && existingSubscription !== null) {
      return { workspaceId: existingTenant.id, slug: existingTenant.slug, name: existingTenant.name, currency, country: input.country, isNew: false, subscription: existingSubscription, pipeline: existingPipeline };
    }
  }

  const tenant = existingTenant ?? await port.createTenant({ slug, name: input.firmName, country: input.country, currency });
  await port.createOwnerMembership({ tenantId: tenant.id, userId: input.userId, email: input.userEmail });
  const pipeline = (await port.findDefaultPipeline(tenant.id)) ?? await port.createDefaultPipeline({ tenantId: tenant.id, name: "Client Pipeline" });

  const existingSub = await port.findTrialSubscription(tenant.id);
  let subscription: CreateWorkspaceResult["subscription"];
  if (existingSub !== null) {
    subscription = existingSub;
  } else {
    const trialResult = await initWorkspaceTrial(trialStore, trialScheduler, { tenantId: tenant.id, workspaceId: tenant.id, workspaceName: input.firmName, ownerEmail: input.userEmail, ownerName: input.userDisplayName }, now);
    subscription = trialResult.subscription;
  }

  return { workspaceId: tenant.id, slug: tenant.slug, name: tenant.name, currency, country: input.country, isNew: existingTenant === null, subscription, pipeline };
};
