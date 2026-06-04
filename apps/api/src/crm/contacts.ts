import {
  createContactRequestSchema,
  updateContactRequestSchema,
  type Contact,
  type CreateContactRequest,
  type PersistenceCorrelationMetadata,
  type UpdateContactRequest,
} from "@whisperm/types";

import { evaluateContactCreateQuota, type BillingQuotaReader } from "../billing/quota.js";
import { ApiError } from "../errors.js";
import {
  firstHeaderValue,
  type FastifyReplyLike,
  type FastifyRequestLike,
} from "../http/fastify.js";

export interface PageRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: string | undefined;
}

export interface ContactImportRow {
  readonly email?: string | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly phone?: string | undefined;
  readonly externalId?: string | undefined;
  readonly stage?: string | undefined;
}

export interface ContactImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: readonly {
    readonly row: number;
    readonly field: string;
    readonly reason: string;
  }[];
}

type ContactFastifyRequest = FastifyRequestLike & {
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
  readonly query?: Readonly<Record<string, string | undefined>> | undefined;
  readonly rawBody?: string | undefined;
};

export interface ContactServicePort {
  create(
    context: ContactRouteContext,
    input: CreateContactRequest,
  ): Promise<Contact> | Contact;
  update(
    context: ContactRouteContext,
    contactId: string,
    input: UpdateContactRequest,
  ): Promise<Contact> | Contact;
  get(
    context: ContactRouteContext,
    contactId: string,
  ): Promise<Contact> | Contact;
  list(
    context: ContactRouteContext,
    page?: PageRequest,
  ): Promise<Page<Contact>> | Page<Contact>;
  importCsvRows?(
    context: ContactRouteContext,
    input: {
      readonly tenantId: string;
      readonly rows: readonly ContactImportRow[];
    },
  ): Promise<ContactImportResult> | ContactImportResult;
}

export interface ContactRouteContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface ContactRouteDependencies {
  readonly contacts: ContactServicePort;
  readonly quota?: BillingQuotaReader | undefined;
  readonly now?: (() => Date) | undefined;
}

interface MultipartFile {
  readonly filename: string;
  readonly contentType: string;
  readonly content: string;
}

const requiredCsvHeaders = ["email", "stage"] as const;
const optionalCsvHeaders = [
  "firstName",
  "lastName",
  "phone",
  "externalId",
] as const;
const allowedCsvHeaders = new Set<string>([
  ...requiredCsvHeaders,
  ...optionalCsvHeaders,
]);

const routeParam = (request: ContactFastifyRequest, name: string): string => {
  const value = request.params?.[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({
      code: "TENANT_CONTEXT_MISMATCH",
      message: `${name} route parameter is required`,
    });
  }
  return value;
};

const headerTenantId = (request: ContactFastifyRequest): string => {
  const value = firstHeaderValue(request.headers, "x-tenant-id")?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({
      code: "TENANT_CONTEXT_MISMATCH",
      message: "Workspace tenant context is required",
    });
  }
  return value;
};

const contactRouteContext = (
  request: ContactFastifyRequest,
): ContactRouteContext => ({
  tenantId:
    request.params?.tenantId === undefined
      ? headerTenantId(request)
      : routeParam(request, "tenantId"),
  actorId: request.auth?.principal.userId,
  correlation: {
    correlationId: request.correlationId ?? request.id ?? "unknown",
  },
});

const parsePageLimit = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError({ code: "REQUEST_BODY_INVALID", message: "limit must be an integer between 1 and 100", statusCode: 400 });
  }
  return limit;
};

const pageRequest = (
  request: ContactFastifyRequest,
): PageRequest | undefined => {
  const query = request.query ?? {};
  const limit = parsePageLimit(query.limit);
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  if (limit === undefined && cursor === undefined) {
    return undefined;
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
};

const sendSuccess = (
  reply: FastifyReplyLike,
  data: unknown,
  correlationId: string | undefined,
): void => {
  reply.send({
    ok: true,
    data,
    meta: { correlationId: correlationId ?? "unknown" },
  });
};

const boundaryFromContentType = (contentType: string | undefined): string => {
  if (
    contentType === undefined ||
    !contentType.toLowerCase().startsWith("multipart/form-data")
  ) {
    throw new ApiError({
      code: "REQUEST_CONTENT_TYPE_INVALID",
      message: "CSV import requires multipart/form-data",
    });
  }
  const boundary = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/u
    .exec(contentType)
    ?.slice(1)
    .find((value) => value !== undefined)
    ?.trim();
  if (boundary === undefined || boundary.length === 0) {
    throw new ApiError({
      code: "REQUEST_BODY_INVALID",
      message: "Multipart boundary is required",
    });
  }
  return boundary;
};

const parseHeaderBlock = (block: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    block.split("\r\n").flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) return [];
      return [
        [
          line.slice(0, separator).trim().toLowerCase(),
          line.slice(separator + 1).trim(),
        ] as const,
      ];
    }),
  );

const parseMultipartFile = (request: ContactFastifyRequest): MultipartFile => {
  const boundary = boundaryFromContentType(
    firstHeaderValue(request.headers, "content-type"),
  );
  const rawBody = request.rawBody ?? "";
  const parts = rawBody
    .split(`--${boundary}`)
    .filter((part) => !part.startsWith("--") && part.trim().length > 0);
  for (const part of parts) {
    const normalizedPart = part.startsWith("\r\n") ? part.slice(2) : part;
    const separator = normalizedPart.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const headers = parseHeaderBlock(normalizedPart.slice(0, separator));
    const disposition = headers["content-disposition"] ?? "";
    if (!/(?:^|;)\s*name="file"(?:;|$)/u.test(disposition)) continue;
    const filename =
      /(?:^|;)\s*filename="([^"]*)"/u.exec(disposition)?.[1]?.trim() ?? "";
    const contentType = headers["content-type"] ?? "text/csv";
    const content = normalizedPart.slice(separator + 4).replace(/\r\n$/u, "");
    if (filename.length === 0 || content.length === 0) {
      throw new ApiError({
        code: "REQUEST_BODY_INVALID",
        message: "CSV import file is required",
      });
    }
    if (
      !/(?:^text\/csv$|^application\/vnd\.ms-excel$|^application\/csv$)/iu.test(
        contentType,
      )
    ) {
      throw new ApiError({
        code: "REQUEST_CONTENT_TYPE_INVALID",
        message: "CSV import file must be text/csv",
      });
    }
    return { filename, contentType, content };
  }
  throw new ApiError({
    code: "REQUEST_BODY_INVALID",
    message: "CSV import file field is required",
  });
};

const parseCsvLine = (line: string): readonly string[] => {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      fields.push(value);
      value = "";
      continue;
    }
    value += character;
  }
  if (quoted) {
    throw new ApiError({
      code: "REQUEST_BODY_INVALID",
      message: "CSV file is unreadable",
    });
  }
  fields.push(value);
  return fields;
};

const parseCsvRows = (content: string): readonly ContactImportRow[] => {
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new ApiError({
      code: "REQUEST_BODY_INVALID",
      message: "CSV file is unreadable",
    });
  }
  const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
  const headerSet = new Set(headers);
  if (
    headers.length === 0 ||
    requiredCsvHeaders.some((header) => !headerSet.has(header)) ||
    headers.some((header) => !allowedCsvHeaders.has(header))
  ) {
    throw new ApiError({
      code: "REQUEST_BODY_INVALID",
      message: "CSV headers must include email and stage",
    });
  }
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) {
      throw new ApiError({
        code: "REQUEST_BODY_INVALID",
        message: "CSV file is unreadable",
      });
    }
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""] as const),
    );
    return {
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      externalId: row.externalId,
      stage: row.stage,
    };
  });
};

export const createContactCreateHandler =
  (dependencies: ContactRouteDependencies) =>
  async (
    request: ContactFastifyRequest,
    reply: FastifyReplyLike,
  ): Promise<void> => {
    const context = contactRouteContext(request);
    const body = createContactRequestSchema.parse(request.body);
    if (body.tenantId !== context.tenantId) {
      throw new ApiError({
        code: "TENANT_CONTEXT_MISMATCH",
        message: "Contact payload tenantId must match route tenantId",
      });
    }
    if (dependencies.quota !== undefined) {
      const quotaDecision = await evaluateContactCreateQuota(
        dependencies.quota,
        context,
        dependencies.now?.() ?? new Date(),
      );
      if (!quotaDecision.allowed) {
        throw new ApiError({
          code: "QUOTA_EXCEEDED",
          message: "Contact quota exceeded for the current plan",
          details: { quotaCode: quotaDecision.code ?? "quota_exceeded", limit: quotaDecision.limit },
        });
      }
    }
    const contact = await dependencies.contacts.create(context, body);
    reply.code(201);
    sendSuccess(reply, contact, context.correlation.correlationId);
  };

export const createContactImportHandler =
  (dependencies: ContactRouteDependencies) =>
  async (
    request: ContactFastifyRequest,
    reply: FastifyReplyLike,
  ): Promise<void> => {
    const context = contactRouteContext(request);
    if (dependencies.contacts.importCsvRows === undefined) {
      throw new ApiError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Contact import is not configured",
      });
    }
    const file = parseMultipartFile(request);
    const result = await dependencies.contacts.importCsvRows(context, {
      tenantId: context.tenantId,
      rows: parseCsvRows(file.content),
    });
    reply.send(result);
  };

export const createContactUpdateHandler =
  (dependencies: ContactRouteDependencies) =>
  async (
    request: ContactFastifyRequest,
    reply: FastifyReplyLike,
  ): Promise<void> => {
    const context = contactRouteContext(request);
    const contact = await dependencies.contacts.update(
      context,
      routeParam(request, "contactId"),
      updateContactRequestSchema.parse(request.body),
    );
    sendSuccess(reply, contact, context.correlation.correlationId);
  };

export const createContactGetHandler =
  (dependencies: ContactRouteDependencies) =>
  async (
    request: ContactFastifyRequest,
    reply: FastifyReplyLike,
  ): Promise<void> => {
    const context = contactRouteContext(request);
    const contact = await dependencies.contacts.get(
      context,
      routeParam(request, "contactId"),
    );
    sendSuccess(reply, contact, context.correlation.correlationId);
  };

export const createContactListHandler =
  (dependencies: ContactRouteDependencies) =>
  async (
    request: ContactFastifyRequest,
    reply: FastifyReplyLike,
  ): Promise<void> => {
    const context = contactRouteContext(request);
    const contacts = await dependencies.contacts.list(
      context,
      pageRequest(request),
    );
    sendSuccess(reply, contacts, context.correlation.correlationId);
  };
