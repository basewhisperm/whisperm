/**
 * ST1-013J: raised by messaging provider transports (WhatsApp/SMS/Email) instead of a generic
 * `Error` so callers can log/display a safe, diagnosable failure -- provider name, HTTP status,
 * a provider-issued error code/category, and whether retrying is expected to help -- without ever
 * carrying the raw provider response body (which may echo back recipient contact data) or any
 * credential.
 */
export interface ProviderDeliveryErrorInput {
  readonly message: string;
  readonly provider: string;
  readonly status?: number | undefined;
  readonly safeCode?: string | undefined;
  readonly safeCategory?: string | undefined;
  readonly requestId?: string | undefined;
  readonly retryable?: boolean | undefined;
}

export interface ProviderDeliverySafeDiagnostic {
  readonly provider: string;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly category?: string | undefined;
  readonly requestId?: string | undefined;
  readonly retryable: boolean;
}

export class ProviderDeliveryError extends Error {
  readonly provider: string;
  readonly status?: number | undefined;
  readonly safeCode?: string | undefined;
  readonly safeCategory?: string | undefined;
  readonly requestId?: string | undefined;
  readonly retryable: boolean;

  constructor(input: ProviderDeliveryErrorInput) {
    super(input.message);
    this.name = "ProviderDeliveryError";
    this.provider = input.provider;
    this.status = input.status;
    this.safeCode = input.safeCode;
    this.safeCategory = input.safeCategory;
    this.requestId = input.requestId;
    this.retryable = input.retryable ?? false;
    Object.setPrototypeOf(this, ProviderDeliveryError.prototype);
  }

  /** Fields safe to persist in invitation metadata, audit logs, or surface to an operator. */
  toSafeDiagnostic(): ProviderDeliverySafeDiagnostic {
    return {
      provider: this.provider,
      status: this.status,
      code: this.safeCode,
      category: this.safeCategory,
      requestId: this.requestId,
      retryable: this.retryable,
    };
  }

  /** Human-readable summary safe to show an operator -- never includes provider payload/contact data. */
  toSafeMessage(): string {
    const parts = [this.provider, this.status !== undefined ? `status ${this.status}` : undefined, this.safeCode !== undefined ? `code ${this.safeCode}` : undefined]
      .filter((part): part is string => part !== undefined);
    return `Provider rejected the invitation request (${parts.join(", ")}).`;
  }
}
