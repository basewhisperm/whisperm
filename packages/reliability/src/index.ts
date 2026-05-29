export const packageName = "@whisperm/reliability" as const;

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export type IncidentSeverity = "SEV0" | "SEV1" | "SEV2" | "SEV3";

export interface HealthThresholds {
  healthyMaxErrorRate: number;
  degradedMaxErrorRate: number;
}

export interface BurnRateInput {
  observedErrorRate: number;
  sloTarget: number;
}

export interface ErrorBudgetRemainingInput {
  totalRequests: number;
  errorRequests: number;
  sloTarget: number;
}

export interface RollingWindowSample {
  totalRequests: number;
  errorRequests: number;
}

export interface RollingWindowBurnRateInput {
  windows: readonly RollingWindowSample[];
  sloTarget: number;
}

export interface ReliabilityIncidentInput {
  burnRate: number;
  errorBudgetRemainingPercent: number;
  status: HealthStatus;
  summary: string;
  tenantId: string;
  correlationId: string;
  occurredAt: Date;
}

export interface ReliabilityIncident {
  severity: IncidentSeverity;
  status: HealthStatus;
  burnRate: number;
  errorBudgetRemainingPercent: number;
  summary: string;
  tenantId: string;
  correlationId: string;
  occurredAt: Date;
}

const assertFiniteNonNegative = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number`);
  }
};

const validateSloTarget = (sloTarget: number): void => {
  if (!Number.isFinite(sloTarget) || sloTarget <= 0 || sloTarget >= 1) {
    throw new RangeError("sloTarget must be between 0 and 1 (exclusive)");
  }
};

const calculateErrorRate = (totalRequests: number, errorRequests: number): number => {
  assertFiniteNonNegative(totalRequests, "totalRequests");
  assertFiniteNonNegative(errorRequests, "errorRequests");
  if (errorRequests > totalRequests) {
    throw new RangeError("errorRequests cannot exceed totalRequests");
  }
  if (totalRequests === 0) {
    return 0;
  }
  return errorRequests / totalRequests;
};

export const calculateBurnRate = (input: BurnRateInput): number => {
  const { observedErrorRate, sloTarget } = input;
  assertFiniteNonNegative(observedErrorRate, "observedErrorRate");
  validateSloTarget(sloTarget);

  const errorBudget = 1 - sloTarget;
  if (errorBudget <= 0) {
    throw new RangeError("error budget must be greater than 0");
  }

  return observedErrorRate / errorBudget;
};

export const calculateRollingWindowBurnRate = (
  input: RollingWindowBurnRateInput,
): number => {
  const { windows, sloTarget } = input;
  if (windows.length === 0) {
    throw new RangeError("windows must include at least one sample");
  }

  const aggregate = windows.reduce(
    (acc, sample) => {
      calculateErrorRate(sample.totalRequests, sample.errorRequests);

      return {
        totalRequests: acc.totalRequests + sample.totalRequests,
        errorRequests: acc.errorRequests + sample.errorRequests,
      };
    },
    { totalRequests: 0, errorRequests: 0 },
  );

  const observedErrorRate = calculateErrorRate(
    aggregate.totalRequests,
    aggregate.errorRequests,
  );

  return calculateBurnRate({ observedErrorRate, sloTarget });
};

export const calculateErrorBudgetRemaining = (
  input: ErrorBudgetRemainingInput,
): number => {
  const { totalRequests, errorRequests, sloTarget } = input;
  validateSloTarget(sloTarget);

  const observedErrorRate = calculateErrorRate(totalRequests, errorRequests);
  const errorBudget = 1 - sloTarget;
  const consumed = observedErrorRate / errorBudget;
  const remaining = 1 - consumed;

  if (remaining < 0) {
    return 0;
  }
  if (remaining > 1) {
    return 1;
  }
  return remaining;
};

export const evaluateHealthStatus = (
  burnRate: number,
  thresholds: HealthThresholds = { healthyMaxErrorRate: 1, degradedMaxErrorRate: 2 },
): HealthStatus => {
  assertFiniteNonNegative(burnRate, "burnRate");
  assertFiniteNonNegative(thresholds.healthyMaxErrorRate, "thresholds.healthyMaxErrorRate");
  assertFiniteNonNegative(thresholds.degradedMaxErrorRate, "thresholds.degradedMaxErrorRate");

  if (thresholds.healthyMaxErrorRate > thresholds.degradedMaxErrorRate) {
    throw new RangeError("healthyMaxErrorRate cannot be greater than degradedMaxErrorRate");
  }

  if (burnRate <= thresholds.healthyMaxErrorRate) {
    return "HEALTHY";
  }
  if (burnRate <= thresholds.degradedMaxErrorRate) {
    return "DEGRADED";
  }
  return "UNHEALTHY";
};

export const createReliabilityIncident = (
  input: ReliabilityIncidentInput,
): ReliabilityIncident => {
  const severity =
    input.status === "UNHEALTHY" || input.errorBudgetRemainingPercent <= 0.05 || input.burnRate >= 10
      ? "SEV0"
      : input.burnRate >= 5 || input.errorBudgetRemainingPercent <= 0.1
        ? "SEV1"
        : input.status === "DEGRADED" || input.burnRate >= 2 || input.errorBudgetRemainingPercent <= 0.25
          ? "SEV2"
          : "SEV3";

  return {
    severity,
    status: input.status,
    burnRate: input.burnRate,
    errorBudgetRemainingPercent: input.errorBudgetRemainingPercent,
    summary: input.summary,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    occurredAt: new Date(input.occurredAt.getTime()),
  };
};
