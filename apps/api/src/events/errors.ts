export type EventIngestionErrorCode =
  | "EVENT_VALIDATION_FAILED"
  | "EVENT_TENANT_REQUIRED"
  | "EVENT_TENANT_MISMATCH"
  | "EVENT_IDEMPOTENCY_CONFLICT"
  | "EVENT_PERSISTENCE_FAILED"
  | "EVENT_QUEUE_ENQUEUE_FAILED";

const defaultStatusByCode: Record<EventIngestionErrorCode, number> = {
  EVENT_VALIDATION_FAILED: 400,
  EVENT_TENANT_REQUIRED: 400,
  EVENT_TENANT_MISMATCH: 403,
  EVENT_IDEMPOTENCY_CONFLICT: 409,
  EVENT_PERSISTENCE_FAILED: 503,
  EVENT_QUEUE_ENQUEUE_FAILED: 503,
};

export interface EventIngestionErrorOptions {
  code: EventIngestionErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
  statusCode?: number;
}

export class EventIngestionError extends Error {
  public readonly code: EventIngestionErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;
  public readonly statusCode: number;

  public constructor(options: EventIngestionErrorOptions) {
    super(options.message);
    this.name = "EventIngestionError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? defaultStatusByCode[options.code];
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
