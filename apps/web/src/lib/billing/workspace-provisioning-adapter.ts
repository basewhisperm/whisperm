import { prisma } from "@/lib/prisma";
import { DEFAULT_PIPELINE_STAGES, type WorkspaceProvisioningPort } from "@whisperm/billing-runtime";

export const workspaceProvisioningPort: WorkspaceProvisioningPort = {
  async findTenantBySlug(slug) {
    return prisma.tenant.findUnique({ where: { slug } });
  },

  async createTenant(input) {
    return prisma.tenant.create({
      data: { slug: input.slug, name: input.name },
    });
  },

  async createOwnerMembership(input) {
    const user = await prisma.tenantUser.create({
      data: {
        tenantId: input.tenantId,
        externalUserId: input.userId,
        email: input.email.toLowerCase(),
        displayName: input.email.split("@")[0] ?? input.email,
        role: "OWNER",
        isActive: true,
      },
    });
    return { id: user.id, tenantId: user.tenantId, role: "OWNER", email: user.email };
  },

  async createDefaultPipeline(input) {
    const pipeline = await prisma.pipeline.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        isDefault: true,
        defaultKey: "default",
        stages: {
          create: DEFAULT_PIPELINE_STAGES.map((stage) => ({
            tenantId: input.tenantId,
            name: stage.name,
            position: stage.position,
            color: stage.color,
          })),
        },
      },
      include: { stages: true },
    });
    return { id: pipeline.id, tenantId: pipeline.tenantId, name: pipeline.name, isDefault: pipeline.isDefault, stageCount: pipeline.stages.length };
  },
};
