import { z } from "zod";

export const retrievalCorrelationMetadataSchema = z.object({
  correlationId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional()
}).strict();

export type RetrievalCorrelationMetadata = z.infer<typeof retrievalCorrelationMetadataSchema>;

export const retrievalMetadataSchema = z.record(z.string(), z.unknown());
export type RetrievalMetadata = z.infer<typeof retrievalMetadataSchema>;

export const retrievalErrorCodeValues = [
  "RETRIEVAL_TENANT_CONTEXT_MISSING",
  "RETRIEVAL_TENANT_CONTEXT_MISMATCH",
  "RETRIEVAL_QUERY_INVALID",
  "RETRIEVAL_PROVIDER_UNAVAILABLE",
  "RETRIEVAL_EMBEDDING_FAILED",
  "RETRIEVAL_VECTOR_SEARCH_FAILED",
  "RETRIEVAL_MEMORY_ACCESS_DENIED",
  "RETRIEVAL_VALIDATION_FAILED"
] as const;

export const retrievalErrorCodeSchema = z.enum(retrievalErrorCodeValues);
export type RetrievalErrorCode = z.infer<typeof retrievalErrorCodeSchema>;

export interface RetrievalErrorInput {
  readonly code: RetrievalErrorCode;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean;
  readonly details?: RetrievalMetadata | undefined;
  readonly correlation?: RetrievalCorrelationMetadata | undefined;
}

export class RetrievalRuntimeError extends Error {
  readonly code: RetrievalErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: RetrievalMetadata | undefined;
  readonly correlation?: RetrievalCorrelationMetadata | undefined;

  constructor(input: RetrievalErrorInput) {
    super(input.message);
    this.name = "RetrievalRuntimeError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
    this.correlation = input.correlation;
    Object.setPrototypeOf(this, RetrievalRuntimeError.prototype);
  }
}

const parseRetrievalSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  correlation: RetrievalCorrelationMetadata | undefined,
): z.output<TSchema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RetrievalRuntimeError({
      code: "RETRIEVAL_VALIDATION_FAILED",
      message: "Retrieval contract validation failed",
      status: 400,
      details: { issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message, code: issue.code })) },
      correlation
    });
  }
  return result.data;
};

export const retrievalProviderKindValues = ["PGVECTOR", "PINECONE", "WEAVIATE", "QDRANT", "OPENSEARCH", "HYBRID", "IN_MEMORY"] as const;
export const retrievalProviderKindSchema = z.enum(retrievalProviderKindValues);
export type RetrievalProviderKind = z.infer<typeof retrievalProviderKindSchema>;

export const embeddingProviderKindValues = ["OPENAI_COMPATIBLE", "LOCAL", "CUSTOM"] as const;
export const embeddingProviderKindSchema = z.enum(embeddingProviderKindValues);
export type EmbeddingProviderKind = z.infer<typeof embeddingProviderKindSchema>;

export const embeddingVectorSchema = z.object({
  dimensions: z.number().int().min(1),
  values: z.array(z.number().finite()).min(1)
}).strict().refine((vector) => vector.values.length === vector.dimensions, {
  message: "Embedding vector dimensions must match values length",
  path: ["values"]
});

export type EmbeddingVector = z.infer<typeof embeddingVectorSchema>;

export const documentChunkSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  documentId: z.string().min(1),
  sourceId: z.string().min(1),
  content: z.string().min(1),
  ordinal: z.number().int().min(0),
  tokenCount: z.number().int().min(0).optional(),
  checksum: z.string().min(1).optional(),
  metadata: retrievalMetadataSchema.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
}).strict();

export type DocumentChunk = z.output<typeof documentChunkSchema>;

export const vectorSearchFilterSchema = z.object({
  tenantId: z.string().min(1),
  documentIds: z.array(z.string().min(1)).optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  metadata: retrievalMetadataSchema.optional()
}).strict();

export type VectorSearchFilter = z.infer<typeof vectorSearchFilterSchema>;

export const vectorSearchRequestSchema = z.object({
  tenantId: z.string().min(1),
  indexName: z.string().min(1),
  vector: embeddingVectorSchema,
  topK: z.number().int().min(1).max(100),
  minScore: z.number().min(0).max(1).optional(),
  filter: vectorSearchFilterSchema,
  correlation: retrievalCorrelationMetadataSchema
}).strict().refine((request) => request.tenantId === request.filter.tenantId, {
  message: "Vector search filter tenantId must match request tenantId",
  path: ["filter", "tenantId"]
});

export type VectorSearchRequest = z.infer<typeof vectorSearchRequestSchema>;

export const vectorSearchMatchSchema = z.object({
  tenantId: z.string().min(1),
  chunk: documentChunkSchema,
  score: z.number().min(0).max(1),
  vectorRef: z.string().min(1).optional(),
  metadata: retrievalMetadataSchema.default({})
}).strict().refine((match) => match.tenantId === match.chunk.tenantId, {
  message: "Vector match tenantId must match chunk tenantId",
  path: ["chunk", "tenantId"]
});

export type VectorSearchMatch = z.output<typeof vectorSearchMatchSchema>;

export const vectorSearchResponseSchema = z.object({
  tenantId: z.string().min(1),
  providerKind: retrievalProviderKindSchema,
  indexName: z.string().min(1),
  matches: z.array(vectorSearchMatchSchema),
  correlation: retrievalCorrelationMetadataSchema
}).strict().refine((response) => response.matches.every((match) => match.tenantId === response.tenantId), {
  message: "All vector matches must share the response tenantId",
  path: ["matches"]
});

export type VectorSearchResponse = z.infer<typeof vectorSearchResponseSchema>;

export const embeddingRequestSchema = z.object({
  tenantId: z.string().min(1),
  model: z.string().min(1),
  input: z.string().min(1),
  dimensions: z.number().int().min(1).optional(),
  correlation: retrievalCorrelationMetadataSchema
}).strict();

export type EmbeddingRequest = z.infer<typeof embeddingRequestSchema>;

export const embeddingResponseSchema = z.object({
  tenantId: z.string().min(1),
  providerKind: embeddingProviderKindSchema,
  model: z.string().min(1),
  vector: embeddingVectorSchema,
  tokenCount: z.number().int().min(0).optional(),
  correlation: retrievalCorrelationMetadataSchema
}).strict();

export type EmbeddingResponse = z.infer<typeof embeddingResponseSchema>;

export const retrievalSearchModeValues = ["VECTOR", "KEYWORD", "HYBRID"] as const;
export const retrievalSearchModeSchema = z.enum(retrievalSearchModeValues);
export type RetrievalSearchMode = z.infer<typeof retrievalSearchModeSchema>;

export const retrievalQuerySchema = z.object({
  tenantId: z.string().min(1),
  query: z.string().min(1),
  indexName: z.string().min(1),
  topK: z.number().int().min(1).max(100),
  mode: retrievalSearchModeSchema.default("VECTOR"),
  filters: vectorSearchFilterSchema.optional(),
  memoryScope: z.string().min(1).optional(),
  correlation: retrievalCorrelationMetadataSchema
}).strict().refine((query) => query.filters === undefined || query.filters.tenantId === query.tenantId, {
  message: "Retrieval filters tenantId must match query tenantId",
  path: ["filters", "tenantId"]
});

export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;

export const retrievalResultSchema = z.object({
  tenantId: z.string().min(1),
  chunk: documentChunkSchema,
  score: z.number().min(0).max(1),
  source: z.enum(["VECTOR", "KEYWORD", "MEMORY", "HYBRID"]),
  metadata: retrievalMetadataSchema.default({})
}).strict().refine((result) => result.tenantId === result.chunk.tenantId, {
  message: "Retrieval result tenantId must match chunk tenantId",
  path: ["chunk", "tenantId"]
});

export type RetrievalResult = z.output<typeof retrievalResultSchema>;

export const retrievalResponseSchema = z.object({
  tenantId: z.string().min(1),
  query: z.string().min(1),
  results: z.array(retrievalResultSchema),
  correlation: retrievalCorrelationMetadataSchema
}).strict().refine((response) => response.results.every((result) => result.tenantId === response.tenantId), {
  message: "All retrieval results must share response tenantId",
  path: ["results"]
});

export type RetrievalResponse = z.infer<typeof retrievalResponseSchema>;

export const memoryRetrievalRequestSchema = z.object({
  tenantId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  memoryScope: z.string().min(1),
  query: z.string().min(1),
  topK: z.number().int().min(1).max(100),
  correlation: retrievalCorrelationMetadataSchema
}).strict();

export type MemoryRetrievalRequest = z.infer<typeof memoryRetrievalRequestSchema>;

export const memoryRetrievalResponseSchema = z.object({
  tenantId: z.string().min(1),
  memoryScope: z.string().min(1),
  results: z.array(retrievalResultSchema),
  correlation: retrievalCorrelationMetadataSchema
}).strict().refine((response) => response.results.every((result) => result.tenantId === response.tenantId), {
  message: "All memory results must share response tenantId",
  path: ["results"]
});

export type MemoryRetrievalResponse = z.infer<typeof memoryRetrievalResponseSchema>;

export interface EmbeddingProvider {
  readonly id: string;
  readonly kind: EmbeddingProviderKind;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface VectorSearchProvider {
  readonly id: string;
  readonly kind: RetrievalProviderKind;
  search(request: VectorSearchRequest): Promise<VectorSearchResponse>;
}

export interface RetrievalProvider {
  retrieve(query: RetrievalQuery): Promise<RetrievalResponse>;
}

export interface MemoryRetriever {
  retrieveMemory(request: MemoryRetrievalRequest): Promise<MemoryRetrievalResponse>;
}

export const assertRetrievalTenantIsolation = (tenantId: string | undefined, tenantScoped: { readonly tenantId?: string | undefined }, correlation?: RetrievalCorrelationMetadata): void => {
  if (tenantId === undefined || tenantId.trim().length === 0 || tenantScoped.tenantId === undefined || tenantScoped.tenantId.trim().length === 0) {
    throw new RetrievalRuntimeError({
      code: "RETRIEVAL_TENANT_CONTEXT_MISSING",
      message: "Retrieval requires explicit tenant context",
      status: 403,
      correlation
    });
  }
  if (tenantId !== tenantScoped.tenantId) {
    throw new RetrievalRuntimeError({
      code: "RETRIEVAL_TENANT_CONTEXT_MISMATCH",
      message: "Retrieval tenant context mismatch",
      status: 403,
      details: { expectedTenantId: tenantId, actualTenantId: tenantScoped.tenantId },
      correlation
    });
  }
};


const toRetrievalRuntimeError = (
  error: unknown,
  code: RetrievalErrorCode,
  message: string,
  correlation: RetrievalCorrelationMetadata,
): RetrievalRuntimeError => {
  if (error instanceof RetrievalRuntimeError) {
    return error;
  }
  return new RetrievalRuntimeError({
    code,
    message,
    status: 502,
    retryable: true,
    correlation
  });
};

export interface ExecuteRetrievalOptions {
  readonly query: RetrievalQuery;
  readonly embeddingProvider: EmbeddingProvider;
  readonly vectorSearchProvider: VectorSearchProvider;
}

export const executeVectorRetrieval = async (options: ExecuteRetrievalOptions): Promise<RetrievalResponse> => {
  const query = parseRetrievalSchema(retrievalQuerySchema, options.query, options.query.correlation);
  let embeddingInput: unknown;
  try {
    embeddingInput = await options.embeddingProvider.embed({
      tenantId: query.tenantId,
      model: "default",
      input: query.query,
      correlation: query.correlation
    });
  } catch (error) {
    throw toRetrievalRuntimeError(error, "RETRIEVAL_EMBEDDING_FAILED", "Embedding provider failed", query.correlation);
  }
  const embedding = parseRetrievalSchema(embeddingResponseSchema, embeddingInput, query.correlation);
  assertRetrievalTenantIsolation(query.tenantId, embedding, query.correlation);

  let searchInput: unknown;
  try {
    searchInput = await options.vectorSearchProvider.search({
      tenantId: query.tenantId,
      indexName: query.indexName,
      vector: embedding.vector,
      topK: query.topK,
      filter: query.filters ?? { tenantId: query.tenantId },
      correlation: query.correlation
    });
  } catch (error) {
    throw toRetrievalRuntimeError(error, "RETRIEVAL_VECTOR_SEARCH_FAILED", "Vector search provider failed", query.correlation);
  }
  const searchResponse = parseRetrievalSchema(
    vectorSearchResponseSchema,
    searchInput,
    query.correlation,
  );
  assertRetrievalTenantIsolation(query.tenantId, searchResponse, query.correlation);
  return parseRetrievalSchema(retrievalResponseSchema, {
    tenantId: query.tenantId,
    query: query.query,
    results: searchResponse.matches.map((match) => ({
      tenantId: match.tenantId,
      chunk: match.chunk,
      score: match.score,
      source: "VECTOR",
      metadata: match.metadata
    })),
    correlation: query.correlation
  }, query.correlation);
};
