import assert from "node:assert/strict";
import test from "node:test";

import {
  RetrievalRuntimeError,
  createDefaultTenantDocumentAccessGuard,
  createDeterministicMemoryScorer,
  createMemoryRetrievalFilter,
  createMinScoreFilter,
  createRetrievalRuntime,
  createScoreRanker,
  memoryRecordSchema,
  pgvectorAdapterContractSchema,
  pineconeAdapterContractSchema,
  retrievalExecutionEventSchema,
  toMemoryDocumentChunk,
  vectorSearchCapabilitiesSchema,
  weaviateAdapterContractSchema
} from "../dist/index.js";

const correlation = { correlationId: "corr-runtime-1", requestId: "req-runtime-1" };
const fixedDate = new Date("2026-01-01T00:00:00.000Z");

const chunk = (overrides = {}) => ({
  id: "chunk-1",
  tenantId: "tenant-1",
  documentId: "doc-1",
  sourceId: "source-1",
  content: "deterministic tenant retrieval memory",
  ordinal: 0,
  metadata: { memoryKind: "WORKING" },
  createdAt: fixedDate.toISOString(),
  ...overrides
});

const createRuntime = (overrides = {}) => {
  const events = [];
  const errors = [];
  const spans = [];
  const embedding = overrides.embedding ?? {
    id: "embedding-local",
    kind: "LOCAL",
    model: "text-embedding-local",
    dimensions: 3,
    async embed(request) {
      assert.equal(request.tenantId, "tenant-1");
      return {
        tenantId: request.tenantId,
        providerKind: "LOCAL",
        model: request.model,
        vector: { dimensions: 3, values: [0.2, 0.3, 0.5] },
        tokenCount: 3,
        correlation: request.correlation
      };
    }
  };
  const vectorSearch = overrides.vectorSearch ?? {
    id: "in-memory-vector",
    kind: "IN_MEMORY",
    providerKind: "IN_MEMORY",
    capabilities: vectorSearchCapabilitiesSchema.parse({
      supportsMetadataFilter: true,
      supportsHybridSearch: false,
      supportsTenantNamespace: true,
      maxTopK: 100
    }),
    async search(request) {
      assert.equal(request.filter.tenantId, request.tenantId);
      return {
        tenantId: request.tenantId,
        providerKind: "IN_MEMORY",
        indexName: request.indexName,
        matches: [
          { tenantId: request.tenantId, chunk: chunk({ id: "chunk-b" }), score: 0.91, metadata: { memoryKind: "WORKING" } },
          { tenantId: request.tenantId, chunk: chunk({ id: "chunk-a", content: "lower score" }), score: 0.75, metadata: { memoryKind: "CONVERSATION" } }
        ],
        correlation: request.correlation
      };
    }
  };
  const runtime = createRetrievalRuntime({
    embedding,
    vectorSearch,
    filters: overrides.filters ?? [createMinScoreFilter(0.8)],
    ranker: overrides.ranker ?? createScoreRanker(),
    documentAccessGuard: overrides.documentAccessGuard ?? createDefaultTenantDocumentAccessGuard(),
    clock: { now: () => fixedDate },
    telemetry: {
      startSpan(name, attributes) {
        const span = { name, attributes, statuses: [], end(status) { this.statuses.push(status); } };
        spans.push(span);
        return span;
      },
      recordEvent(event) {
        events.push(retrievalExecutionEventSchema.parse(event));
      },
      recordError(error) {
        errors.push(error);
      }
    }
  });
  return { runtime, events, errors, spans };
};

test("retrieval runtime executes embedding, vector search, filtering, ranking, guard, and telemetry deterministically", async () => {
  const { runtime, events, errors, spans } = createRuntime();

  const response = await runtime.retrieve({
    tenantId: "tenant-1",
    query: "tenant retrieval",
    indexName: "tenant-1-memory",
    topK: 5,
    correlation
  });

  assert.equal(response.tenantId, "tenant-1");
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].chunk.id, "chunk-b");
  assert.deepEqual(events.map((event) => event.type), [
    "retrieval.execution.started",
    "retrieval.embedding.completed",
    "retrieval.vector_search.completed",
    "retrieval.filter.completed",
    "retrieval.rank.completed",
    "retrieval.execution.completed"
  ]);
  assert.equal(events[0].id, "tenant-1:corr-runtime-1:validate:0");
  assert.equal(events.every((event) => event.replaySafe === true && event.tenantId === "tenant-1"), true);
  assert.equal(errors.length, 0);
  assert.equal(spans[0].statuses[0], "OK");
});

test("retrieval runtime fails closed when mocked vector provider crosses tenant boundaries", async () => {
  const { runtime, events, errors, spans } = createRuntime({
    vectorSearch: {
      id: "bad-vector",
      kind: "IN_MEMORY",
      providerKind: "IN_MEMORY",
      capabilities: vectorSearchCapabilitiesSchema.parse({ supportsMetadataFilter: true, supportsHybridSearch: false, supportsTenantNamespace: true, maxTopK: 10 }),
      async search(request) {
        return {
          tenantId: request.tenantId,
          providerKind: "IN_MEMORY",
          indexName: request.indexName,
          matches: [{ tenantId: "tenant-2", chunk: chunk({ tenantId: "tenant-2" }), score: 0.9 }],
          correlation: request.correlation
        };
      }
    }
  });

  await assert.rejects(
    () => runtime.retrieve({ tenantId: "tenant-1", query: "tenant retrieval", indexName: "idx", topK: 3, correlation }),
    (error) => error instanceof RetrievalRuntimeError && error.code === "RETRIEVAL_VALIDATION_FAILED"
  );
  assert.equal(events.at(-1).type, "retrieval.execution.failed");
  assert.equal(errors.length, 1);
  assert.equal(spans[0].statuses[0], "ERROR");
});

test("adapter contracts validate pgvector, Pinecone, and Weaviate configuration without SDKs", () => {
  assert.equal(pgvectorAdapterContractSchema.parse({
    providerKind: "PGVECTOR",
    tableName: "document_vectors",
    vectorColumn: "embedding",
    tenantColumn: "tenant_id",
    contentColumn: "content",
    dimensions: 1536,
    distance: "cosine"
  }).tenantColumn, "tenant_id");

  assert.equal(pineconeAdapterContractSchema.parse({
    providerKind: "PINECONE",
    indexName: "whisperm-memory",
    namespaceStrategy: "tenant_id",
    tenantMetadataKey: "tenantId",
    dimensions: 1536,
    metric: "cosine"
  }).namespaceStrategy, "tenant_id");

  assert.equal(weaviateAdapterContractSchema.parse({
    providerKind: "WEAVIATE",
    className: "TenantMemory",
    tenantProperty: "tenantId",
    contentProperty: "content",
    dimensions: 1536,
    distance: "cosine"
  }).className, "TenantMemory");
});

test("memory contracts enforce tenant-safe audit metadata, scoring, conversion, and retrieval policies", () => {
  const memory = memoryRecordSchema.parse({
    id: "memory-1",
    tenantId: "tenant-1",
    kind: "WORKING",
    scope: "conversation-1",
    content: "tenant retrieval memory",
    importance: 0.8,
    audit: { tenantId: "tenant-1", correlation, createdAt: fixedDate.toISOString(), replayId: "replay-1" }
  });
  const scorer = createDeterministicMemoryScorer();
  const score = scorer.score({ tenantId: "tenant-1", query: "retrieval memory", memory, correlation });
  assert.equal(score.finalScore > 0.8, true);

  const chunkFromMemory = toMemoryDocumentChunk(memory);
  assert.equal(chunkFromMemory.tenantId, "tenant-1");
  assert.equal(chunkFromMemory.metadata.memoryKind, "WORKING");

  const filter = createMemoryRetrievalFilter({ name: "working-only", kinds: ["WORKING"], maxResults: 3, minScore: 0.5, includeExpired: false, replaySafe: true });
  const filtered = filter.filter({
    tenantId: "tenant-1",
    query: { tenantId: "tenant-1", query: "retrieval", indexName: "idx", topK: 3, correlation },
    correlation,
    results: [
      { tenantId: "tenant-1", chunk: chunkFromMemory, score: 0.9, source: "MEMORY", metadata: { memoryKind: "WORKING" } },
      { tenantId: "tenant-1", chunk: chunk({ id: "conversation" }), score: 0.9, source: "MEMORY", metadata: { memoryKind: "CONVERSATION" } }
    ]
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].metadata.memoryKind, "WORKING");

  assert.throws(() => memoryRecordSchema.parse({ ...memory, audit: { ...memory.audit, tenantId: "tenant-2" } }));
});
