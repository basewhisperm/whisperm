import { z } from "zod";

import {
  AiRuntimeError,
  aiCorrelationMetadataSchema,
  aiPromptMessageSchema,
  aiRuntimePayloadSchema,
  aiTenantExecutionContextSchema,
  assertAiTenantIsolation,
  type AiCorrelationMetadata,
  type AiPromptMessage,
  type AiTenantExecutionContext,
} from "./ai.js";

export const promptTemplateStatusValues = ["DRAFT", "ACTIVE", "DEPRECATED", "ARCHIVED"] as const;
export const promptTemplateStatusSchema = z.enum(promptTemplateStatusValues);
export type PromptTemplateStatus = z.infer<typeof promptTemplateStatusSchema>;

export const promptVariableKindValues = ["STRING", "NUMBER", "BOOLEAN", "JSON", "STRING_ARRAY"] as const;
export const promptVariableKindSchema = z.enum(promptVariableKindValues);
export type PromptVariableKind = z.infer<typeof promptVariableKindSchema>;

export const promptVariableDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[A-Za-z][A-Za-z0-9_]*$/u),
  kind: promptVariableKindSchema,
  required: z.boolean().default(true),
  description: z.string().min(1).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), aiRuntimePayloadSchema]).optional(),
  sensitive: z.boolean().default(false)
}).strict();

export type PromptVariableDefinition = z.infer<typeof promptVariableDefinitionSchema>;

export const promptSafetyPolicySchema = z.object({
  policyId: z.string().min(1),
  allowExternalKnowledge: z.boolean().default(false),
  requireTenantGrounding: z.literal(true),
  allowToolCalls: z.boolean().default(false),
  allowMemoryReferences: z.boolean().default(false),
  blockedTopics: z.array(z.string().min(1)).default([]),
  piiHandling: z.enum(["REDACT", "REFERENCE_ONLY", "ALLOW_TENANT_SCOPED"]),
  humanApprovalRequired: z.boolean().default(false)
}).strict();

export type PromptSafetyPolicy = z.infer<typeof promptSafetyPolicySchema>;

export const promptAuditMetadataSchema = z.object({
  createdByActorId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedByActorId: z.string().min(1).optional(),
  updatedAt: z.string().datetime().optional(),
  approvedByActorId: z.string().min(1).optional(),
  approvedAt: z.string().datetime().optional(),
  changeReason: z.string().min(1).optional(),
  correlation: aiCorrelationMetadataSchema
}).strict();

export type PromptAuditMetadata = z.infer<typeof promptAuditMetadataSchema>;

export const promptTemplateVersionSchema = z.object({
  templateId: z.string().min(1),
  version: z.string().min(1),
  status: promptTemplateStatusSchema,
  messages: z.array(aiPromptMessageSchema.extend({ content: z.string().min(1) })).min(1),
  variables: z.array(promptVariableDefinitionSchema).default([]),
  safety: promptSafetyPolicySchema,
  audit: promptAuditMetadataSchema,
  metadata: aiRuntimePayloadSchema.optional()
}).strict().superRefine((version, ctx) => {
  const variableNames = new Set<string>();
  for (const variable of version.variables) {
    if (variableNames.has(variable.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Prompt variable names must be unique", path: ["variables", variable.name] });
    }
    variableNames.add(variable.name);
  }
});

export type PromptTemplateVersion = z.infer<typeof promptTemplateVersionSchema>;

export const promptTemplateSchema = z.object({
  tenantId: z.string().min(1),
  templateId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  currentVersion: z.string().min(1),
  versions: z.array(promptTemplateVersionSchema).min(1),
  tags: z.array(z.string().min(1)).default([])
}).strict().superRefine((template, ctx) => {
  const versions = new Set<string>();
  let currentFound = false;
  for (const version of template.versions) {
    if (version.templateId !== template.templateId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Prompt version templateId must match parent template", path: ["versions", version.version, "templateId"] });
    }
    if (versions.has(version.version)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Prompt versions must be unique", path: ["versions", version.version] });
    }
    versions.add(version.version);
    if (version.version === template.currentVersion) {
      currentFound = true;
    }
  }
  if (!currentFound) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "currentVersion must reference a declared prompt version", path: ["currentVersion"] });
  }
});

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

export const promptResolutionRequestSchema = z.object({
  tenantId: z.string().min(1),
  templateId: z.string().min(1),
  version: z.string().min(1).optional(),
  variables: aiRuntimePayloadSchema.default({}),
  executionContext: aiTenantExecutionContextSchema,
  correlation: aiCorrelationMetadataSchema
}).strict();

export type PromptResolutionRequest = z.infer<typeof promptResolutionRequestSchema>;

export const compiledPromptSchema = z.object({
  tenantId: z.string().min(1),
  templateId: z.string().min(1),
  version: z.string().min(1),
  messages: z.array(aiPromptMessageSchema).min(1),
  variables: aiRuntimePayloadSchema,
  safety: promptSafetyPolicySchema,
  audit: promptAuditMetadataSchema,
  correlation: aiCorrelationMetadataSchema
}).strict();

export type CompiledPrompt = z.infer<typeof compiledPromptSchema>;

export const promptEvaluationStatusValues = ["PASSED", "FAILED", "WARNING"] as const;
export const promptEvaluationStatusSchema = z.enum(promptEvaluationStatusValues);
export type PromptEvaluationStatus = z.infer<typeof promptEvaluationStatusSchema>;

export const promptEvaluationResultSchema = z.object({
  tenantId: z.string().min(1),
  templateId: z.string().min(1),
  version: z.string().min(1),
  evaluationId: z.string().min(1),
  status: promptEvaluationStatusSchema,
  score: z.number().min(0).max(1).optional(),
  findings: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(["INFO", "WARNING", "ERROR"])
  }).strict()).default([]),
  evaluatedAt: z.string().datetime(),
  correlation: aiCorrelationMetadataSchema
}).strict();

export type PromptEvaluationResult = z.infer<typeof promptEvaluationResultSchema>;

export interface PromptRegistryReader {
  resolve(request: PromptResolutionRequest): Promise<PromptTemplate>;
}

export interface PromptRegistryWriter {
  upsert(template: PromptTemplate, correlation: AiCorrelationMetadata): Promise<PromptTemplate>;
}

export interface PromptRegistry extends PromptRegistryReader, PromptRegistryWriter {}

const interpolationPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/gu;

const promptContractError = (
  message: string,
  correlation: AiCorrelationMetadata | undefined,
  details: Record<string, unknown> = {},
): AiRuntimeError => new AiRuntimeError({
  code: "AI_PROMPT_INVALID",
  message,
  status: 422,
  details,
  correlation
});

const stringifyPromptVariable = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

const validateVariableValue = (
  definition: PromptVariableDefinition,
  value: unknown,
  correlation: AiCorrelationMetadata,
): unknown => {
  if (value === undefined) {
    if (definition.defaultValue !== undefined) {
      return definition.defaultValue;
    }
    if (definition.required) {
      throw promptContractError("Prompt variable is required", correlation, { variable: definition.name });
    }
    return "";
  }

  const valid =
    (definition.kind === "STRING" && typeof value === "string")
    || (definition.kind === "NUMBER" && typeof value === "number" && Number.isFinite(value))
    || (definition.kind === "BOOLEAN" && typeof value === "boolean")
    || (definition.kind === "STRING_ARRAY" && Array.isArray(value) && value.every((item) => typeof item === "string"))
    || (definition.kind === "JSON" && typeof value === "object" && value !== null && !Array.isArray(value));

  if (!valid) {
    throw promptContractError("Prompt variable value does not match declared kind", correlation, {
      variable: definition.name,
      expectedKind: definition.kind
    });
  }
  return value;
};

export const extractPromptVariables = (content: string): readonly string[] => {
  const variables = new Set<string>();
  for (const match of content.matchAll(interpolationPattern)) {
    const name = match[1];
    if (name !== undefined) {
      variables.add(name);
    }
  }
  return [...variables].sort();
};

export const validatePromptTemplateVersion = (version: PromptTemplateVersion, correlation: AiCorrelationMetadata): PromptTemplateVersion => {
  const parsed = promptTemplateVersionSchema.parse(version);
  const declared = new Set(parsed.variables.map((variable) => variable.name));
  const referenced = new Set(parsed.messages.flatMap((message) => extractPromptVariables(message.content)));

  for (const variable of referenced) {
    if (!declared.has(variable)) {
      throw promptContractError("Prompt template references an undeclared variable", correlation, { variable });
    }
  }
  return parsed;
};

export const interpolatePromptText = (
  content: string,
  variables: Readonly<Record<string, unknown>>,
  correlation: AiCorrelationMetadata,
): string => content.replace(interpolationPattern, (_match: string, variableName: string) => {
  if (!Object.prototype.hasOwnProperty.call(variables, variableName)) {
    throw promptContractError("Prompt interpolation variable is missing", correlation, { variable: variableName });
  }
  return stringifyPromptVariable(variables[variableName]);
});

export const injectExecutionContextMessages = (
  messages: readonly AiPromptMessage[],
  context: AiTenantExecutionContext,
): readonly AiPromptMessage[] => {
  const parsedContext = aiTenantExecutionContextSchema.parse(context);
  const contextMessage: AiPromptMessage = {
    role: "DEVELOPER",
    content: [
      "Execution context:",
      `tenantId=${parsedContext.tenantId}`,
      `agentId=${parsedContext.agentId}`,
      `executionId=${parsedContext.executionId}`,
      `mode=${parsedContext.mode}`,
      `correlationId=${parsedContext.correlation.correlationId}`
    ].join("\n"),
    metadata: { injected: true, kind: "EXECUTION_CONTEXT" }
  };
  return [contextMessage, ...messages];
};

export const compilePromptTemplate = (input: {
  readonly context: AiTenantExecutionContext;
  readonly template: PromptTemplate;
  readonly request: PromptResolutionRequest;
  readonly injectExecutionContext?: boolean;
}): CompiledPrompt => {
  const context = aiTenantExecutionContextSchema.parse(input.context);
  const template = promptTemplateSchema.parse(input.template);
  const request = promptResolutionRequestSchema.parse(input.request);
  assertAiTenantIsolation(context, template);
  assertAiTenantIsolation(context, request);
  assertAiTenantIsolation(context, request.executionContext);

  const selectedVersion = request.version ?? template.currentVersion;
  const version = template.versions.find((candidate) => candidate.version === selectedVersion);
  if (version === undefined || version.status !== "ACTIVE") {
    throw promptContractError("Prompt version is not active or does not exist", request.correlation, {
      templateId: template.templateId,
      version: selectedVersion
    });
  }

  const validatedVersion = validatePromptTemplateVersion(version, request.correlation);
  const compiledVariables = Object.fromEntries(validatedVersion.variables.map((definition) => [
    definition.name,
    validateVariableValue(definition, request.variables[definition.name], request.correlation)
  ]));
  const allowedVariables = new Set(validatedVersion.variables.map((definition) => definition.name));
  for (const suppliedName of Object.keys(request.variables)) {
    if (!allowedVariables.has(suppliedName)) {
      throw promptContractError("Prompt request supplied an undeclared variable", request.correlation, { variable: suppliedName });
    }
  }

  const messages = validatedVersion.messages.map((message) => aiPromptMessageSchema.parse({
    ...message,
    content: interpolatePromptText(message.content, compiledVariables, request.correlation)
  }));

  return compiledPromptSchema.parse({
    tenantId: template.tenantId,
    templateId: template.templateId,
    version: validatedVersion.version,
    messages: input.injectExecutionContext === false ? messages : injectExecutionContextMessages(messages, context),
    variables: compiledVariables,
    safety: validatedVersion.safety,
    audit: validatedVersion.audit,
    correlation: request.correlation
  });
};

export const resolveTenantPrompt = async (
  registry: PromptRegistryReader,
  request: PromptResolutionRequest,
): Promise<PromptTemplate> => {
  const parsedRequest = promptResolutionRequestSchema.parse(request);
  assertAiTenantIsolation(parsedRequest.executionContext, parsedRequest);
  const template = promptTemplateSchema.parse(await registry.resolve(parsedRequest));
  assertAiTenantIsolation(parsedRequest.executionContext, template);
  if (template.templateId !== parsedRequest.templateId) {
    throw promptContractError("Prompt registry returned a different template", parsedRequest.correlation, {
      requestedTemplateId: parsedRequest.templateId,
      actualTemplateId: template.templateId
    });
  }
  return template;
};
