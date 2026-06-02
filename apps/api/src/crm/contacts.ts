import {
  createContactRequestSchema,
  updateContactRequestSchema,
  type Contact,
  type CreateContactRequest,
  type PersistenceCorrelationMetadata,
  type UpdateContactRequest,
} from "@whisperm/types";

import { ApiError } from "../errors.js";
import { type FastifyReplyLike, type FastifyRequestLike } from "../http/fastify.js";

export interface PageRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: string | undefined;
}

type ContactFastifyRequest = FastifyRequestLike & {
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
  readonly query?: Readonly<Record<string, string | undefined>> | undefined;
};

export interface ContactServicePort {
  create(context: ContactRouteContext, input: CreateContactRequest): Promise<Contact> | Contact;
  update(context: ContactRouteContext, contactId: string, input: UpdateContactRequest): Promise<Contact> | Contact;
  get(context: ContactRouteContext, contactId: string): Promise<Contact> | Contact;
  list(context: ContactRouteContext, page?: PageRequest): Promise<Page<Contact>> | Page<Contact>;
}

export interface ContactRouteContext {
  readonly tenantId: string;
  readonly actorId?: string | undefined;
  readonly correlation: PersistenceCorrelationMetadata;
}

export interface ContactRouteDependencies {
  readonly contacts: ContactServicePort;
}

const routeParam = (request: ContactFastifyRequest, name: string): string => {
  const value = request.params?.[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: `${name} route parameter is required` });
  }
  return value;
};

const contactRouteContext = (request: ContactFastifyRequest): ContactRouteContext => ({
  tenantId: routeParam(request, "tenantId"),
  correlation: { correlationId: request.correlationId ?? request.id ?? "unknown" },
});

const pageRequest = (request: ContactFastifyRequest): PageRequest | undefined => {
  const query = request.query ?? {};
  const limit = typeof query.limit === "string" ? Number(query.limit) : undefined;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  if (limit === undefined && cursor === undefined) {
    return undefined;
  }
  return { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) };
};

const sendSuccess = (reply: FastifyReplyLike, data: unknown, correlationId: string | undefined): void => {
  reply.send({ ok: true, data, meta: { correlationId: correlationId ?? "unknown" } });
};

export const createContactCreateHandler = (dependencies: ContactRouteDependencies) => async (request: ContactFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = contactRouteContext(request);
  const body = createContactRequestSchema.parse(request.body);
  if (body.tenantId !== context.tenantId) {
    throw new ApiError({ code: "TENANT_CONTEXT_MISMATCH", message: "Contact payload tenantId must match route tenantId" });
  }
  const contact = await dependencies.contacts.create(context, body);
  reply.code(201);
  sendSuccess(reply, contact, context.correlation.correlationId);
};

export const createContactUpdateHandler = (dependencies: ContactRouteDependencies) => async (request: ContactFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = contactRouteContext(request);
  const contact = await dependencies.contacts.update(context, routeParam(request, "contactId"), updateContactRequestSchema.parse(request.body));
  sendSuccess(reply, contact, context.correlation.correlationId);
};

export const createContactGetHandler = (dependencies: ContactRouteDependencies) => async (request: ContactFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = contactRouteContext(request);
  const contact = await dependencies.contacts.get(context, routeParam(request, "contactId"));
  sendSuccess(reply, contact, context.correlation.correlationId);
};

export const createContactListHandler = (dependencies: ContactRouteDependencies) => async (request: ContactFastifyRequest, reply: FastifyReplyLike): Promise<void> => {
  const context = contactRouteContext(request);
  const contacts = await dependencies.contacts.list(context, pageRequest(request));
  sendSuccess(reply, contacts, context.correlation.correlationId);
};
