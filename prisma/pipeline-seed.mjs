export const defaultPipelineName = "Default Pipeline";

export const defaultPipelineStages = Object.freeze([
  Object.freeze({ name: "Prospect", position: 1, color: "#64748B" }),
  Object.freeze({ name: "Qualified", position: 2, color: "#2563EB" }),
  Object.freeze({ name: "Proposal", position: 3, color: "#7C3AED" }),
  Object.freeze({ name: "Engagement", position: 4, color: "#16A34A" }),
  Object.freeze({ name: "Renewal", position: 5, color: "#F59E0B" }),
]);

const tenantIdFromWorkspace = (workspace) => workspace.tenantId ?? workspace.id;

const foundingClientWorkspaces = async (prisma, workspaces) => {
  if (workspaces !== undefined) return workspaces;
  return prisma.tenant.findMany({ where: {}, orderBy: { id: "asc" } });
};

export const seedDefaultPipelines = async (prisma, options = {}) => {
  const workspaces = await foundingClientWorkspaces(prisma, options.workspaces);
  let pipelines = 0;
  let stages = 0;

  for (const workspace of workspaces) {
    const tenantId = tenantIdFromWorkspace(workspace);
    const pipeline = await prisma.pipeline.upsert({
      where: { tenantId_defaultKey: { tenantId, defaultKey: "default" } },
      create: {
        tenantId,
        name: options.pipelineName ?? defaultPipelineName,
        isDefault: true,
        defaultKey: "default",
      },
      update: {
        name: options.pipelineName ?? defaultPipelineName,
        isDefault: true,
        defaultKey: "default",
      },
    });
    pipelines += 1;

    for (const stage of defaultPipelineStages) {
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
