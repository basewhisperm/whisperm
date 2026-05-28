import assert from "node:assert/strict";
import test from "node:test";

import {
  RetrievalRuntimeError,
  assertRetrievalTenantIsolation,
  documentChunkSchema,
  embeddingVectorSchema,
  executeVectorRetrieval,
  retrievalQuerySchema,
  vectorSearchResponseSchema
} from "../dist/index.js";

const correlation = { correlationId: "corr-retrieval-1", requestId: "req-retrieval-1" };

const chunk = (overrides = {}) => ({
  id: "chunk-1",
  tenantId: "tenant-1",
  documentId: "doc-1",
  sourceId: "kb-1",
  content: "Tenant-scoped CRM context.",
  ordinal: 0,
  metadata: { kind: "note" },
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

test("retrieval schemas validate document chunks, embeddings, and tenant-scoped queries", () => {
  assert.equal(documentChunkSchema.parse(chunk()).tenantId, "tenant-1");
  assert.equal(embeddingVectorSchema.parse({ dimensions: 3, values: [0.1, 0.2, 0.3] }).dimensions, 3);

  assert.throws(() => {
    embeddingVectorSchema.parse({ dimensions: 2, values: [0.1] });
  });

  assert.throws(() => {
    retrievalQuerySchema.parse({
      tenantId: "tenant-1",
      query: "find lead memory",
      indexName: "tenant-memory",
      topK: 5,
      filters: { tenantId: "tenant-2" },
      correlation
    });
  });
});

test("retrieval tenant guard fails closed on missing or mismatched tenants", () => {
  assert.doesNotThrow(() => assertRetrievalTenantIsolation("tenant-1", { tenantId: "tenant-1" }, correlation));

  assert.throws(
    () => assertRetrievalTenantIsolation(undefined, { tenantId: "tenant-1" }, correlation),
    (error) => error instanceof RetrievalRuntimeError && error.code === "RETRIEVAL_TENANT_CONTEXT_MISSING"
  );

  assert.throws(
    () => assertRetrievalTenantIsolation("tenant-1", { tenantId: "tenant-2" }, correlation),
    (error) => error instanceof RetrievalRuntimeError && error.code === "RETRIEVAL_TENANT_CONTEXT_MISMATCH"
  );
});

test("vector retrieval composes provider-neutral embedding and vector search contracts", async () => {
  const embeddingProvider = {
    id: "embedding-local",
    kind: "LOCAL",
    async embed(request) {
      return {
        tenantId: request.tenantId,
        providerKind: "LOCAL",
        model: request.model,
        vector: { dimensions: 2, values: [0.1, 0.9] },
        correlation: request.correlation
      };
    }
  };
  const vectorSearchProvider = {
    id: "vector-memory",
    kind: "IN_MEMORY",
    async search(request) {
      return vectorSearchResponseSchema.parse({
        tenantId: request.tenantId,
        providerKind: "IN_MEMORY",
        indexName: request.indexName,
        matches: [{ tenantId: request.tenantId, chunk: chunk(), score: 0.91 }],
        correlation: request.correlation
      });
    }
  };

  const response = await executeVectorRetrieval({
    query: {
      tenantId: "tenant-1",
      query: "crm context",
      indexName: "tenant-memory",
      topK: 3,
      correlation
    },
    embeddingProvider,
    vectorSearchProvider
  });

  assert.equal(response.tenantId, "tenant-1");
  assert.equal(response.results[0].source, "VECTOR");
  assert.equal(response.results[0].chunk.documentId, "doc-1");
});

test("vector retrieval rejects provider responses that cross tenant boundaries", async () => {
  const embeddingProvider = {
    id: "embedding-local",
    kind: "LOCAL",
    async embed(request) {
      return {
        tenantId: request.tenantId,
        providerKind: "LOCAL",
        model: request.model,
        vector: { dimensions: 2, values: [0.1, 0.9] },
        correlation: request.correlation
      };
    }
  };
  const vectorSearchProvider = {
    id: "vector-memory",
    kind: "IN_MEMORY",
    async search(request) {
      return {
        tenantId: request.tenantId,
        providerKind: "IN_MEMORY",
        indexName: request.indexName,
        matches: [{ tenantId: "tenant-2", chunk: chunk({ tenantId: "tenant-2" }), score: 0.91 }],
        correlation: request.correlation
      };
    }
  };

  await assert.rejects(
    async () => executeVectorRetrieval({
      query: {
        tenantId: "tenant-1",
        query: "crm context",
        indexName: "tenant-memory",
        topK: 3,
        correlation
      },
      embeddingProvider,
      vectorSearchProvider
    }),
    (error) => error instanceof RetrievalRuntimeError && error.code === "RETRIEVAL_VALIDATION_FAILED"
  );
});
