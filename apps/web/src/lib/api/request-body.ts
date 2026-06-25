import type { NextRequest } from "next/server";

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 = 400,
    readonly code = status === 413 ? "REQUEST_BODY_TOO_LARGE" : "REQUEST_BODY_INVALID",
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export interface ReadBodyOptions {
  readonly maxBytes?: number;
  readonly allowFormData?: boolean;
}

const DEFAULT_MAX_BYTES = 64_000;

const contentLengthOf = (request: NextRequest): number | null => {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export const readJsonBody = async <T = unknown>(
  request: NextRequest,
  options: ReadBodyOptions = {},
): Promise<T> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const contentLength = contentLengthOf(request);

  if (contentLength !== null && contentLength > maxBytes) {
    throw new RequestBodyError("Request body is too large.", 413);
  }

  try {
    return await request.json() as T;
  } catch {
    throw new RequestBodyError("Request body must be valid JSON.", 400);
  }
};

export const readJsonOrFormBody = async (
  request: NextRequest,
  options: ReadBodyOptions = {},
): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("application/json")) {
    const value = await readJsonBody<unknown>(request, options);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  if (options.allowFormData === true) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const contentLength = contentLengthOf(request);
    if (contentLength !== null && contentLength > maxBytes) {
      throw new RequestBodyError("Request body is too large.", 413);
    }

    try {
      return Object.fromEntries((await request.formData()).entries());
    } catch {
      throw new RequestBodyError("Request body must be valid form data.", 400);
    }
  }

  throw new RequestBodyError("Unsupported request content type.", 415, "REQUEST_CONTENT_TYPE_INVALID");
};
