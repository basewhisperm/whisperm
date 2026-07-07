export interface BillingErrorInput {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
  readonly cause?: unknown;
}

export class BillingError extends Error {
  readonly code: string;
  readonly statusCode: number;
  override readonly cause?: unknown;

  constructor(input: BillingErrorInput) {
    super(input.message);
    this.name = "BillingError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.cause = input.cause;
  }
}
