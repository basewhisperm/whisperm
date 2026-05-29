import { z } from "zod";

import {
  type DocumentChunk,
  type EmbeddingProvider,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type EmbeddingVector,
  RetrievalRuntimeError,
  type RetrievalCorrelationMetadata,
  type RetrievalMetadata,
  type RetrievalQuery,
  type RetrievalResponse,
  type RetrievalResult,
  type VectorSearchMatch,
  type VectorSearchProvider,
  type VectorSearchRequest,
  type VectorSearchResponse,
  assertRetrievalTenantIsolation,
  documentChunkSchema,
  embeddingRequestSchema,
  embeddingResponseSchema,
  embeddingVectorSchema,
  retrievalCorrelationMetadataSchema,
  retrievalMetadataSchema,
  retrievalQuerySchema,
  retrievalResponseSchema,
  retrievalResultSchema,
  vectorSearchRequestSchema,
  vectorSearchResponseSchema
} from "@whisperm/types";

export type {
  DocumentChunk,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingVector,
  RetrievalCorrelationMetadata,
  RetrievalMetadata,
  RetrievalQuery,
  RetrievalResponse,
  RetrievalResult,
  VectorSearchMatch,
  VectorSearchProvider,
  VectorSearchRequest,
  VectorSearchResponse
};
export { RetrievalRuntimeError };

export const retrievalRuntimeProviderKindValues = [
  "PGVECTOR",
  "PINECONE",
  "WEAVIATE",
  "QDRANT",
  "OPENSEARCH",
  "REDIS_VECTOR",
  "HYBRID",
  "IN_MEMORY"
] as const;
export const retrievalRuntimeProviderKindSchema = z.enum(retrievalRuntimeProviderKindValues);
export type RetrievalRuntimeProviderKind = z.infer<typeof retrievalRuntimeProviderKindSchema>;

export const retrievalExecutionStageValues = ["VALIDATE", "EMBED", "SEARCH", "FILTER", "RANK", "COMPLETE"] as const;
export const retrievalExecutionStageSchema = z.enum(retrievalExecutionStageValues);
export type RetrievalExecutionStage = z.infer<typeof retrievalExecutionStageSchema>;

export const retrievalExecutionEventTypeValues = [
  "retrieval.execution.started",
  "retrieval.embedding.completed",
  "retrieval.vector_search.completed",
  "retrieval.filter.completed",
  "retrieval.rank.completed",
  "retrieval.execution.completed",
  "retrieval.execution.failed"
] as const;
export const retrievalExecutionEventTypeSchema = z.enum(retrievalExecutionEventTypeValues);
export type RetrievalExecutionEventType = z.infer<typeof retrievalExecutionEventTypeSchema>;

export const retrievalExecutionEventSchema = z.object({
  id: z.string().min(1),
  type: retrievalExecutionEventTypeSchema,
  version: z.literal(1),
  tenantId: z.string().min(1),
  occurredAt: z.string().datetime(),
  stage: retrievalExecutionStageSchema,
  correlation: retrievalCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1),
  replaySafe: z.literal(true),
  payload: retrievalMetadataSchema.default({})
}).strict();
export type RetrievalExecutionEvent = z.output<typeof retrievalExecutionEventSchema>;

export interface RetrievalClock {
  now(): Date;
}

export interface RetrievalIdFactory {
  createId(input: { readonly tenantId: string; readonly correlation: RetrievalCorrelationMetadata; readonly stage: RetrievalExecutionStage; readonly sequence: number }): string;
}

export interface RetrievalTelemetrySpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  end(status: "OK" | "ERROR"): void;
}

export interface RetrievalTelemetryHooks {
  startSpan?(name: string, attributes: Readonly<Record<string, string | number | boolean>>): RetrievalTelemetrySpan;
  recordEvent?(event: RetrievalExecutionEvent): void | Promise<void>;
  recordError?(input: { readonly error: RetrievalRuntimeError; readonly tenantId: string; readonly correlation: RetrievalCorrelationMetadata; readonly stage: RetrievalExecutionStage }): void | Promise<void>;
}

export interface RetrievalRanker {
  rank(input: { readonly tenantId: string; readonly query: RetrievalQuery; readonly results: readonly RetrievalResult[]; readonly correlation: RetrievalCorrelationMetadata }): Promise<readonly RetrievalResult[]> | readonly RetrievalResult[];
}

export interface RetrievalFilter {
  filter(input: { readonly tenantId: string; readonly query: RetrievalQuery; readonly results: readonly RetrievalResult[]; readonly correlation: RetrievalCorrelationMetadata }): Promise<readonly RetrievalResult[]> | readonly RetrievalResult[];
}

export interface TenantDocumentAccessGuard {
  assertCanRead(input: { readonly tenantId: string; readonly query: RetrievalQuery; readonly chunk: DocumentChunk; readonly correlation: RetrievalCorrelationMetadata }): void | Promise<void>;
}

export interface RetrievalService {
  retrieve(query: RetrievalQuery): Promise<RetrievalResponse>;
}

export interface EmbeddingExecutionContract extends EmbeddingProvider {
  readonly model: string;
  readonly dimensions?: number;
}

export interface VectorSearchRuntimeAdapter extends VectorSearchProvider {
  readonly providerKind: RetrievalRuntimeProviderKind;
  readonly capabilities: VectorSearchCapabilities;
}

export const vectorSearchCapabilitiesSchema = z.object({
  supportsMetadataFilter: z.boolean(),
  supportsHybridSearch: z.boolean(),
  supportsTenantNamespace: z.boolean(),
  supportsSparseVector: z.boolean().default(false),
  maxTopK: z.number().int().min(1).max(10000)
}).strict();
export type VectorSearchCapabilities = z.output<typeof vectorSearchCapabilitiesSchema>;

export const pgvectorAdapterContractSchema = z.object({
  providerKind: z.literal("PGVECTOR"),
  tableName: z.string().min(1),
  vectorColumn: z.string().min(1),
  tenantColumn: z.string().min(1),
  contentColumn: z.string().min(1),
  metadataColumn: z.string().min(1).optional(),
  dimensions: z.number().int().min(1),
  distance: z.enum(["cosine", "inner_product", "l2"])
}).strict();
export type PgvectorAdapterContract = z.infer<typeof pgvectorAdapterContractSchema>;

export const pineconeAdapterContractSchema = z.object({
  providerKind: z.literal("PINECONE"),
  indexName: z.string().min(1),
  namespaceStrategy: z.enum(["tenant_id", "metadata_filter"]),
  tenantMetadataKey: z.string().min(1),
  dimensions: z.number().int().min(1),
  metric: z.enum(["cosine", "dotproduct", "euclidean"])
}).strict();
export type PineconeAdapterContract = z.infer<typeof pineconeAdapterContractSchema>;

export const weaviateAdapterContractSchema = z.object({
  providerKind: z.literal("WEAVIATE"),
  className: z.string().min(1),
  tenantProperty: z.string().min(1),
  contentProperty: z.string().min(1),
  metadataProperty: z.string().min(1).optional(),
  dimensions: z.number().int().min(1),
  distance: z.enum(["cosine", "dot", "l2-squared", "hamming", "manhattan"])
}).strict();
export type WeaviateAdapterContract = z.infer<typeof weaviateAdapterContractSchema>;

export const qdrantAdapterContractSchema = z.object({
  providerKind: z.literal("QDRANT"),
  collectionName: z.string().min(1),
  tenantPayloadKey: z.string().min(1),
  dimensions: z.number().int().min(1),
  distance: z.enum(["Cosine", "Dot", "Euclid", "Manhattan"])
}).strict();
export type QdrantAdapterContract = z.infer<typeof qdrantAdapterContractSchema>;

export const retrievalProviderAdapterContractSchema = z.discriminatedUnion("providerKind", [
  pgvectorAdapterContractSchema,
  pineconeAdapterContractSchema,
  weaviateAdapterContractSchema,
  qdrantAdapterContractSchema
]);
export type RetrievalProviderAdapterContract = z.infer<typeof retrievalProviderAdapterContractSchema>;

export const createDefaultTenantDocumentAccessGuard = (): TenantDocumentAccessGuard => ({
  assertCanRead(input) {
    assertRetrievalTenantIsolation(input.tenantId, input.chunk, input.correlation);
  }
});

export const createScoreRanker = (): RetrievalRanker => ({
  rank(input) {
    return [...input.results].sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.chunk.id.localeCompare(right.chunk.id);
    });
  }
});

export const createMinScoreFilter = (minScore: number): RetrievalFilter => {
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new RetrievalRuntimeError({ code: "RETRIEVAL_VALIDATION_FAILED", message: "minScore must be between 0 and 1", status: 400 });
  }
  return {
    filter(input) {
      return input.results.filter((result) => result.score >= minScore);
    }
  };
};

export interface RetrievalRuntimeDependencies {
  readonly embedding: EmbeddingExecutionContract;
  readonly vectorSearch: VectorSearchRuntimeAdapter;
  readonly filters?: readonly RetrievalFilter[];
  readonly ranker?: RetrievalRanker;
  readonly documentAccessGuard?: TenantDocumentAccessGuard;
  readonly telemetry?: RetrievalTelemetryHooks;
  readonly clock?: RetrievalClock;
  readonly idFactory?: RetrievalIdFactory;
}

const systemClock: RetrievalClock = { now: () => new Date() };

const deterministicIdFactory: RetrievalIdFactory = {
  createId(input) {
    return [input.tenantId, input.correlation.correlationId, input.stage.toLowerCase(), String(input.sequence)].join(":");
  }
};

const toRuntimeError = (error: unknown, stage: RetrievalExecutionStage, correlation: RetrievalCorrelationMetadata): RetrievalRuntimeError => {
  if (error instanceof RetrievalRuntimeError) {
    return error;
  }
  if (error instanceof z.ZodError) {
    return new RetrievalRuntimeError({
      code: "RETRIEVAL_VALIDATION_FAILED",
      message: "Retrieval contract validation failed",
      status: 400,
      details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message, code: issue.code })) },
      correlation
    });
  }
  const code = stage === "EMBED" ? "RETRIEVAL_EMBEDDING_FAILED" : stage === "SEARCH" ? "RETRIEVAL_VECTOR_SEARCH_FAILED" : "RETRIEVAL_PROVIDER_UNAVAILABLE";
  return new RetrievalRuntimeError({ code, message: `Retrieval ${stage.toLowerCase()} stage failed`, status: 502, retryable: true, correlation });
};

const emitEvent = async (
  dependencies: Pick<RetrievalRuntimeDependencies, "clock" | "idFactory" | "telemetry">,
  input: { readonly tenantId: string; readonly correlation: RetrievalCorrelationMetadata; readonly stage: RetrievalExecutionStage; readonly type: RetrievalExecutionEventType; readonly sequence: number; readonly payload?: RetrievalMetadata }
): Promise<RetrievalExecutionEvent> => {
  const event = retrievalExecutionEventSchema.parse({
    id: (dependencies.idFactory ?? deterministicIdFactory).createId(input),
    type: input.type,
    version: 1,
    tenantId: input.tenantId,
    occurredAt: (dependencies.clock ?? systemClock).now().toISOString(),
    stage: input.stage,
    correlation: input.correlation,
    idempotencyKey: [input.tenantId, input.correlation.correlationId, input.type, String(input.sequence)].join(":"),
    replaySafe: true,
    payload: input.payload ?? {}
  });
  await dependencies.telemetry?.recordEvent?.(event);
  return event;
};

const buildEmbeddingRequest = (query: RetrievalQuery, embedding: EmbeddingExecutionContract): EmbeddingRequest => embeddingRequestSchema.parse({
  tenantId: query.tenantId,
  model: embedding.model,
  input: query.query,
  dimensions: embedding.dimensions,
  correlation: query.correlation
});

const buildVectorSearchRequest = (query: RetrievalQuery, vector: EmbeddingVector): VectorSearchRequest => vectorSearchRequestSchema.parse({
  tenantId: query.tenantId,
  indexName: query.indexName,
  vector,
  topK: query.topK,
  filter: query.filters ?? { tenantId: query.tenantId },
  correlation: query.correlation
});

const toRetrievalResults = (query: RetrievalQuery, response: VectorSearchResponse): RetrievalResult[] => response.matches.map((match) => retrievalResultSchema.parse({
  tenantId: query.tenantId,
  chunk: match.chunk,
  score: match.score,
  source: query.mode === "HYBRID" ? "HYBRID" : "VECTOR",
  metadata: match.metadata
}));

const assertResultsReadable = async (guard: TenantDocumentAccessGuard, query: RetrievalQuery, results: readonly RetrievalResult[]): Promise<void> => {
  for (const result of results) {
    assertRetrievalTenantIsolation(query.tenantId, result, query.correlation);
    await guard.assertCanRead({ tenantId: query.tenantId, query, chunk: result.chunk, correlation: query.correlation });
  }
};

export const createRetrievalRuntime = (dependencies: RetrievalRuntimeDependencies): RetrievalService => ({
  async retrieve(input) {
    const query = retrievalQuerySchema.parse(input);
    const span = dependencies.telemetry?.startSpan?.("whisperm.retrieval.execute", {
      "whisperm.tenant_id": query.tenantId,
      "whisperm.correlation_id": query.correlation.correlationId,
      "whisperm.retrieval.mode": query.mode,
      "whisperm.retrieval.index": query.indexName,
      "whisperm.retrieval.top_k": query.topK
    });
    const guard = dependencies.documentAccessGuard ?? createDefaultTenantDocumentAccessGuard();
    try {
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "VALIDATE", type: "retrieval.execution.started", sequence: 0 });

      let embeddingInput: unknown;
      try {
        embeddingInput = await dependencies.embedding.embed(buildEmbeddingRequest(query, dependencies.embedding));
      } catch (error) {
        throw toRuntimeError(error, "EMBED", query.correlation);
      }
      const embedding = embeddingResponseSchema.parse(embeddingInput);
      assertRetrievalTenantIsolation(query.tenantId, embedding, query.correlation);
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "EMBED", type: "retrieval.embedding.completed", sequence: 1, payload: { providerId: dependencies.embedding.id, providerKind: dependencies.embedding.kind, dimensions: embedding.vector.dimensions } });

      let searchInput: unknown;
      try {
        searchInput = await dependencies.vectorSearch.search(buildVectorSearchRequest(query, embedding.vector));
      } catch (error) {
        throw toRuntimeError(error, "SEARCH", query.correlation);
      }
      const searchResponse = vectorSearchResponseSchema.parse(searchInput);
      assertRetrievalTenantIsolation(query.tenantId, searchResponse, query.correlation);
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "SEARCH", type: "retrieval.vector_search.completed", sequence: 2, payload: { providerId: dependencies.vectorSearch.id, providerKind: dependencies.vectorSearch.providerKind, matchCount: searchResponse.matches.length } });

      let results: readonly RetrievalResult[] = toRetrievalResults(query, searchResponse);
      await assertResultsReadable(guard, query, results);

      for (const filter of dependencies.filters ?? []) {
        results = await filter.filter({ tenantId: query.tenantId, query, results, correlation: query.correlation });
      }
      await assertResultsReadable(guard, query, results);
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "FILTER", type: "retrieval.filter.completed", sequence: 3, payload: { resultCount: results.length } });

      const ranked = await (dependencies.ranker ?? createScoreRanker()).rank({ tenantId: query.tenantId, query, results, correlation: query.correlation });
      await assertResultsReadable(guard, query, ranked);
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "RANK", type: "retrieval.rank.completed", sequence: 4, payload: { resultCount: ranked.length } });

      const response = retrievalResponseSchema.parse({ tenantId: query.tenantId, query: query.query, results: ranked.slice(0, query.topK), correlation: query.correlation });
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "COMPLETE", type: "retrieval.execution.completed", sequence: 5, payload: { resultCount: response.results.length } });
      span?.end("OK");
      return response;
    } catch (error) {
      const runtimeError = toRuntimeError(error, "COMPLETE", query.correlation);
      await dependencies.telemetry?.recordError?.({ error: runtimeError, tenantId: query.tenantId, correlation: query.correlation, stage: "COMPLETE" });
      await emitEvent(dependencies, { tenantId: query.tenantId, correlation: query.correlation, stage: "COMPLETE", type: "retrieval.execution.failed", sequence: 99, payload: { code: runtimeError.code, retryable: runtimeError.retryable } });
      span?.end("ERROR");
      throw runtimeError;
    }
  }
});

export const memoryKindValues = ["CONVERSATION", "WORKING", "EPISODIC"] as const;
export const memoryKindSchema = z.enum(memoryKindValues);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryAuditMetadataSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  correlation: retrievalCorrelationMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  reason: z.string().min(1).optional(),
  replayId: z.string().min(1).optional()
}).strict();
export type MemoryAuditMetadata = z.infer<typeof memoryAuditMetadataSchema>;

export const memoryRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: memoryKindSchema,
  scope: z.string().min(1),
  content: z.string().min(1),
  embedding: embeddingVectorSchema.optional(),
  importance: z.number().min(0).max(1).default(0.5),
  metadata: retrievalMetadataSchema.default({}),
  audit: memoryAuditMetadataSchema
}).strict().refine((record) => record.tenantId === record.audit.tenantId, {
  message: "Memory audit tenantId must match record tenantId",
  path: ["audit", "tenantId"]
});
export type MemoryRecord = z.output<typeof memoryRecordSchema>;

export const memoryWriteRequestSchema = z.object({
  tenantId: z.string().min(1),
  kind: memoryKindSchema,
  scope: z.string().min(1),
  content: z.string().min(1),
  metadata: retrievalMetadataSchema.default({}),
  correlation: retrievalCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1)
}).strict();
export type MemoryWriteRequest = z.output<typeof memoryWriteRequestSchema>;

export const memoryRetentionPolicySchema = z.object({
  name: z.string().min(1),
  maxAgeDays: z.number().int().min(1).optional(),
  maxRecords: z.number().int().min(1).optional(),
  deleteStrategy: z.enum(["HARD_DELETE", "SOFT_DELETE", "ARCHIVE"]),
  replaySafe: z.literal(true)
}).strict();
export type MemoryRetentionPolicy = z.infer<typeof memoryRetentionPolicySchema>;

export const memoryRetrievalPolicySchema = z.object({
  name: z.string().min(1),
  kinds: z.array(memoryKindSchema).min(1),
  maxResults: z.number().int().min(1).max(100),
  minScore: z.number().min(0).max(1).default(0),
  includeExpired: z.boolean().default(false),
  replaySafe: z.literal(true)
}).strict();
export type MemoryRetrievalPolicy = z.output<typeof memoryRetrievalPolicySchema>;

export const memoryCompactionRequestSchema = z.object({
  tenantId: z.string().min(1),
  scope: z.string().min(1),
  sourceMemoryIds: z.array(z.string().min(1)).min(1),
  targetKind: memoryKindSchema,
  correlation: retrievalCorrelationMetadataSchema,
  idempotencyKey: z.string().min(1)
}).strict();
export type MemoryCompactionRequest = z.infer<typeof memoryCompactionRequestSchema>;

export const memoryCompactionPlanSchema = z.object({
  tenantId: z.string().min(1),
  scope: z.string().min(1),
  sourceMemoryIds: z.array(z.string().min(1)).min(1),
  compactedContent: z.string().min(1),
  replaySafe: z.literal(true),
  audit: memoryAuditMetadataSchema
}).strict().refine((plan) => plan.tenantId === plan.audit.tenantId, {
  message: "Memory compaction audit tenantId must match plan tenantId",
  path: ["audit", "tenantId"]
});
export type MemoryCompactionPlan = z.infer<typeof memoryCompactionPlanSchema>;

export const memoryScoreSchema = z.object({
  memoryId: z.string().min(1),
  tenantId: z.string().min(1),
  relevance: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  finalScore: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).default([])
}).strict();
export type MemoryScore = z.output<typeof memoryScoreSchema>;

export interface MemoryScorer {
  score(input: { readonly tenantId: string; readonly query: string; readonly memory: MemoryRecord; readonly correlation: RetrievalCorrelationMetadata }): MemoryScore;
}

export interface ConversationMemoryStore {
  appendTurn(request: MemoryWriteRequest): Promise<MemoryRecord>;
  listConversationMemory(input: { readonly tenantId: string; readonly scope: string; readonly correlation: RetrievalCorrelationMetadata }): Promise<readonly MemoryRecord[]>;
}

export interface WorkingMemoryStore {
  upsertWorkingMemory(request: MemoryWriteRequest): Promise<MemoryRecord>;
  clearWorkingMemory(input: { readonly tenantId: string; readonly scope: string; readonly correlation: RetrievalCorrelationMetadata; readonly idempotencyKey: string }): Promise<void>;
}

export interface EpisodicMemoryStore {
  appendEpisode(request: MemoryWriteRequest): Promise<MemoryRecord>;
  listEpisodes(input: { readonly tenantId: string; readonly scope: string; readonly correlation: RetrievalCorrelationMetadata }): Promise<readonly MemoryRecord[]>;
}

export interface MemoryCompactor {
  planCompaction(request: z.infer<typeof memoryCompactionRequestSchema>): Promise<MemoryCompactionPlan> | MemoryCompactionPlan;
}

export interface MemoryRuntimeContracts {
  readonly conversation?: ConversationMemoryStore;
  readonly working?: WorkingMemoryStore;
  readonly episodic?: EpisodicMemoryStore;
  readonly compactor?: MemoryCompactor;
  readonly scorer?: MemoryScorer;
  readonly retentionPolicies: readonly MemoryRetentionPolicy[];
  readonly retrievalPolicies: readonly MemoryRetrievalPolicy[];
}

export const assertMemoryTenantIsolation = (tenantId: string, memory: MemoryRecord, correlation: RetrievalCorrelationMetadata): void => {
  assertRetrievalTenantIsolation(tenantId, memory, correlation);
  assertRetrievalTenantIsolation(tenantId, memory.audit, correlation);
};

export const createDeterministicMemoryScorer = (): MemoryScorer => ({
  score(input) {
    assertMemoryTenantIsolation(input.tenantId, input.memory, input.correlation);
    const queryTerms = new Set(input.query.toLowerCase().split(/\s+/u).filter((term) => term.length > 0));
    const contentTerms = new Set(input.memory.content.toLowerCase().split(/\s+/u).filter((term) => term.length > 0));
    const overlap = [...queryTerms].filter((term) => contentTerms.has(term)).length;
    const relevance = queryTerms.size === 0 ? 0 : overlap / queryTerms.size;
    const recency = 1;
    const importance = input.memory.importance;
    const finalScore = Math.min(1, (relevance * 0.6) + (importance * 0.3) + (recency * 0.1));
    return memoryScoreSchema.parse({
      memoryId: input.memory.id,
      tenantId: input.tenantId,
      relevance,
      recency,
      importance,
      finalScore,
      reasons: ["deterministic-term-overlap", "importance-weight", "replay-stable-recency"]
    });
  }
});

export const toMemoryDocumentChunk = (memory: MemoryRecord): DocumentChunk => documentChunkSchema.parse({
  id: memory.id,
  tenantId: memory.tenantId,
  documentId: `memory:${memory.kind}:${memory.scope}`,
  sourceId: memory.scope,
  content: memory.content,
  ordinal: 0,
  metadata: { ...memory.metadata, memoryKind: memory.kind },
  createdAt: memory.audit.createdAt,
  updatedAt: memory.audit.updatedAt
});

export const createMemoryRetrievalFilter = (policy: MemoryRetrievalPolicy): RetrievalFilter => {
  const parsedPolicy = memoryRetrievalPolicySchema.parse(policy);
  return {
    filter(input) {
      return input.results
        .filter((result) => {
          const kind = result.metadata["memoryKind"];
          return typeof kind === "string" && parsedPolicy.kinds.includes(memoryKindSchema.parse(kind));
        })
        .filter((result) => result.score >= parsedPolicy.minScore)
        .slice(0, parsedPolicy.maxResults);
    }
  };
};
