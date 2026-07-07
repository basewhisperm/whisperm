/**
 * workspace-provisioning.ts — WorkspaceProvisioningService
 * Provisions: Tenant, OWNER membership, default pipeline.
 * No Stripe/Paystack customers created here.
 *
 * SECURITY: the original version of this function treated a slug collision as "the same
 * workspace" and silently attached the *caller's* membership to whatever tenant it found --
 * including one it had no relationship to (a prior signup with the same firm name, a crashed
 * partial provisioning, etc). That is a cross-tenant privilege escalation, not idempotency: two
 * different people signing up with firm names that normalize to the same slug ended up merged
 * into one tenant, with the second caller granted OWNER on the first caller's data.
 *
 * This version never reuses an unrelated tenant. Callers are expected to have already checked
 * "does this user already have a workspace?" (e.g. via a TenantUser lookup by email) before
 * calling this -- createWorkspace's only job is to mint a brand-new, uniquely-slugged workspace.
 * If slug generation cannot find a free slug within a bounded number of attempts, it throws
 * rather than silently attaching to someone else's tenant.
 */
export const generateWorkspaceSlug = (firmName: string): string =>
  firmName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "workspace";

const randomSlugSuffix = (): string => Math.random().toString(36).slice(2, 8);

const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  GH: "GHS", US: "USD", GB: "GBP", NG: "NGN", CA: "CAD", AU: "AUD",
};

export const currencyForCountry = (country: string): string =>
  COUNTRY_CURRENCY[country.toUpperCase()] ?? "USD";

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
  createDefaultPipeline(input: { tenantId: string; name: string }): Promise<CreatedPipeline>;
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
  readonly pipeline: CreatedPipeline;
}

const MAX_SLUG_ATTEMPTS = 5;

const findAvailableSlug = async (port: WorkspaceProvisioningPort, firmName: string): Promise<string> => {
  const base = generateWorkspaceSlug(firmName);
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix()}`;
    if ((await port.findTenantBySlug(candidate)) === null) return candidate;
  }
  throw new Error(`Could not generate a unique workspace slug for "${firmName}" after ${MAX_SLUG_ATTEMPTS} attempts`);
};

export const createWorkspace = async (
  port: WorkspaceProvisioningPort,
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> => {
  const slug = await findAvailableSlug(port, input.firmName);
  const currency = input.currency ?? currencyForCountry(input.country);

  const tenant = await port.createTenant({ slug, name: input.firmName, country: input.country, currency });
  await port.createOwnerMembership({ tenantId: tenant.id, userId: input.userId, email: input.userEmail });
  const pipeline = await port.createDefaultPipeline({ tenantId: tenant.id, name: "Client Pipeline" });

  return { workspaceId: tenant.id, slug: tenant.slug, name: tenant.name, currency, country: input.country, pipeline };
};
