import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const DEFAULT_PIPELINE_NAME = "Default Pipeline";

const DEFAULT_PIPELINE_STAGES = [
  { name: "Prospect", position: 1, color: "#64748B" },
  { name: "Qualified", position: 2, color: "#2563EB" },
  { name: "Proposal", position: 3, color: "#7C3AED" },
  { name: "Engagement", position: 4, color: "#16A34A" },
  { name: "Renewal", position: 5, color: "#F59E0B" },
] as const;

const TRIAL_DURATION_DAYS = 14;
const MAX_SLUG_ATTEMPTS = 4;

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "workspace").slice(0, 40);
}

function randomSlugSuffix(): string {
  return randomBytes(3).toString("hex");
}

export interface ProvisionedWorkspace {
  readonly tenantId: string;
  readonly tenantUserId: string;
}

/**
 * The slice of the Prisma client this module needs, expressed as an
 * interface so tests can supply a fake in-memory client -- this repo has no
 * local Postgres to integration-test against (see prisma/demo-seed.test.mjs
 * for the same pattern).
 */
export interface WorkspaceProvisioningTransactionClient {
  tenant: {
    create(args: { data: { slug: string; name: string } }): Promise<{ id: string }>;
  };
  tenantUser: {
    create(args: {
      data: {
        tenantId: string;
        email: string;
        displayName: string | null;
        role: "OWNER";
        isActive: true;
      };
    }): Promise<{ id: string }>;
  };
  pipeline: {
    create(args: {
      data: { tenantId: string; name: string; isDefault: boolean; defaultKey: string };
    }): Promise<{ id: string }>;
  };
  pipelineStage: {
    createMany(args: {
      data: readonly { tenantId: string; pipelineId: string; name: string; position: number; color: string }[];
    }): Promise<unknown>;
  };
  subscription: {
    create(args: {
      data: {
        tenantId: string;
        plan: "STARTER";
        status: "TRIALING";
        currency: string;
        trialEndsAt: Date;
      };
    }): Promise<unknown>;
  };
}

export interface WorkspaceProvisioningClient {
  $transaction<T>(fn: (tx: WorkspaceProvisioningTransactionClient) => Promise<T>): Promise<T>;
  tenantUser: {
    findFirst(args: {
      where: { email: string; isActive: true };
    }): Promise<{ id: string; tenantId: string } | null>;
  };
}

/**
 * Creates a brand-new tenant, an OWNER TenantUser, a default CRM pipeline,
 * and a 14-day trial Subscription for a signed-in Clerk user with no
 * existing TenantUser row. This is currently the only path that turns a
 * live sign-up into a workspace -- every other tenant in this system comes
 * from a seed script.
 *
 * Retries with a randomized slug suffix on a slug collision. On an email
 * collision (a concurrent request already provisioned this user), returns
 * the winner's TenantUser instead of failing.
 */
export async function provisionWorkspaceForUser(
  input: {
    readonly email: string;
    readonly displayName?: string | undefined;
  },
  client: WorkspaceProvisioningClient = prisma as unknown as WorkspaceProvisioningClient,
): Promise<ProvisionedWorkspace> {
  const email = input.email.toLowerCase();
  const baseSlug = slugify(input.displayName ?? email.split("@")[0] ?? "workspace");

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;

    try {
      return await client.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { slug, name: input.displayName?.trim() || slug },
        });

        const tenantUser = await tx.tenantUser.create({
          data: {
            tenantId: tenant.id,
            email,
            displayName: input.displayName ?? null,
            role: "OWNER",
            isActive: true,
          },
        });

        const pipeline = await tx.pipeline.create({
          data: {
            tenantId: tenant.id,
            name: DEFAULT_PIPELINE_NAME,
            isDefault: true,
            defaultKey: "default",
          },
        });

        await tx.pipelineStage.createMany({
          data: DEFAULT_PIPELINE_STAGES.map((stage) => ({
            tenantId: tenant.id,
            pipelineId: pipeline.id,
            name: stage.name,
            position: stage.position,
            color: stage.color,
          })),
        });

        const trialEndsAt = new Date();
        trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_DURATION_DAYS);

        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            plan: "STARTER",
            status: "TRIALING",
            currency: "USD",
            trialEndsAt,
          },
        });

        return { tenantId: tenant.id, tenantUserId: tenantUser.id };
      });
    } catch (error) {
      const isUniqueViolation = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isUniqueViolation) throw error;

      const target = (error.meta?.target as readonly string[] | undefined) ?? [];
      const collidedOnSlug = target.some((field) => field.toLowerCase().includes("slug"));

      if (collidedOnSlug && attempt < MAX_SLUG_ATTEMPTS - 1) {
        continue;
      }

      const existing = await client.tenantUser.findFirst({ where: { email, isActive: true } });
      if (existing) return { tenantId: existing.tenantId, tenantUserId: existing.id };

      throw error;
    }
  }

  throw new Error("Failed to provision workspace: could not allocate a unique tenant slug");
}
