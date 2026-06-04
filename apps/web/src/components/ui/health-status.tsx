import { cn } from "@/lib/utils";

const healthStatusStyles = {
  green: "bg-growth",
  amber: "bg-health-amber",
  red: "bg-health-red",
} as const;

export type HealthStatusTone = keyof typeof healthStatusStyles;

export interface HealthStatusProps {
  className?: string;
  lastTouchedDaysAgo: number;
  status: HealthStatusTone;
}

export function HealthStatus({
  className,
  lastTouchedDaysAgo,
  status,
}: HealthStatusProps) {
  const accessibleStatus = `Health status: ${formatStatus(status)}. Last touched ${lastTouchedDaysAgo} ${lastTouchedDaysAgo === 1 ? "day" : "days"} ago.`;

  return (
    <span
      aria-label={accessibleStatus}
      className={cn(
        "inline-flex h-2.5 w-16 rounded-full",
        healthStatusStyles[status],
        className,
      )}
      role="img"
    />
  );
}

function formatStatus(status: HealthStatusTone) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
