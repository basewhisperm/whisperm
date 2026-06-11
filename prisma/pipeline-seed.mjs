export const defaultPipelineName = "Default Pipeline";

export const defaultPipelineStages = Object.freeze([
  Object.freeze({ name: "Prospect", position: 1, color: "#64748B" }),
  Object.freeze({ name: "Qualified", position: 2, color: "#2563EB" }),
  Object.freeze({ name: "Proposal", position: 3, color: "#7C3AED" }),
  Object.freeze({ name: "Engagement", position: 4, color: "#16A34A" }),
  Object.freeze({ name: "Renewal", position: 5, color: "#F59E0B" }),
]);

export const marketplaceAcquisitionPipelineName = "Marketplace Acquisition";
export const marketplaceAcquisitionPipelineDefaultKey = "marketplace_acquisition";

export const marketplaceAcquisitionPipelineStages = Object.freeze([
  Object.freeze({ name: "Captured", position: 1, color: "#64748B" }),
  Object.freeze({ name: "Invited", position: 2, color: "#2563EB" }),
  Object.freeze({ name: "Converted", position: 3, color: "#16A34A" }),
]);

const tenantIdFromWorkspace = (workspace) => workspace.tenantId ?? workspace.id;

const foundingClientWorkspaces = async (prisma, workspaces) => {
  if (workspaces !== undefined) return workspaces;
  return prisma.tenant.findMany({ where: {}, orderBy: { id: "asc" } });
};

const seedPipelineForWorkspaces = async (prisma, options) => {
  const workspaces = await foundingClientWorkspaces(prisma, options.workspaces);
  let pipelines = 0;
  let stages = 0;

  for (const workspace of workspaces) {
    const tenantId = tenantIdFromWorkspace(workspace);
    const pipeline = await prisma.pipeline.upsert({
      where: { tenantId_defaultKey: { tenantId, defaultKey: options.defaultKey } },
      create: {
        tenantId,
        name: options.pipelineName,
        isDefault: options.isDefault,
        defaultKey: options.defaultKey,
      },
      update: {
        name: options.pipelineName,
        isDefault: options.isDefault,
        defaultKey: options.defaultKey,
      },
    });
    pipelines += 1;

    for (const stage of options.stages) {
      await prisma.pipelineStage.upsert({
        where: {
          tenantId_pipelineId_name: {
            tenantId,
            pipelineId: pipeline.id,
            name: stage.name,
          },
        },
        create: {
          tenantId,
          pipelineId: pipeline.id,
          name: stage.name,
          position: stage.position,
          color: stage.color,
        },
        update: {
          position: stage.position,
          color: stage.color,
        },
      });
      stages += 1;
    }
  }

  return { workspaces: workspaces.length, pipelines, stages };
};

export const seedDefaultPipelines = async (prisma, options = {}) => seedPipelineForWorkspaces(prisma, {
  ...options,
  pipelineName: options.pipelineName ?? defaultPipelineName,
  isDefault: true,
  defaultKey: "default",
  stages: defaultPipelineStages,
});

export const seedMarketplaceAcquisitionPipeline = async (prisma, options = {}) => seedPipelineForWorkspaces(prisma, {
  ...options,
  pipelineName: options.pipelineName ?? marketplaceAcquisitionPipelineName,
  isDefault: false,
  defaultKey: marketplaceAcquisitionPipelineDefaultKey,
  stages: marketplaceAcquisitionPipelineStages,
});

export const seedPipelines = async (prisma, options = {}) => {
  const workspaces = await foundingClientWorkspaces(prisma, options.workspaces);
  const defaultResult = await seedDefaultPipelines(prisma, { ...options, workspaces });
  const marketplaceAcquisitionResult = await seedMarketplaceAcquisitionPipeline(prisma, { ...options, workspaces });

  return {
    workspaces: workspaces.length,
    pipelines: defaultResult.pipelines + marketplaceAcquisitionResult.pipelines,
    stages: defaultResult.stages + marketplaceAcquisitionResult.stages,
  };
};
