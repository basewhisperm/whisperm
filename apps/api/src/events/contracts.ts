import type { NormalizedInboundEvent } from "@whisperm/types";

export interface EventIdempotencyReservation {
  tenantId: string;
  idempotencyKey: string;
  eventId: string;
  correlationId: string;
}

export interface EventIdempotencyProtection {
  reserve(input: EventIdempotencyReservation): Promise<"reserved" | "duplicate">;
  markSucceeded(input: EventIdempotencyReservation): Promise<void>;
  markFailed(input: EventIdempotencyReservation & { reasonCode: string }): Promise<void>;
}

export interface EventPersistenceService {
  persistInboundEvent(event: NormalizedInboundEvent): Promise<void>;
}

export interface EventQueueMessage {
  tenantId: string;
  eventId: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface EventQueue {
  enqueueInboundEvent(message: EventQueueMessage): Promise<void>;
}

export interface RetrySafeEventProcessor<TEvent extends NormalizedInboundEvent = NormalizedInboundEvent> {
  process(event: TEvent, context: {
    tenantId: string;
    correlationId: string;
    idempotencyKey: string;
    attempt: number;
  }): Promise<void>;
}
