export type ContactHealthStatus = "green" | "amber" | "red";

export interface ContactHealth {
  readonly status: ContactHealthStatus;
  readonly fillPct: number;
  readonly daysSinceLastTouch: number | null;
}

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export const computeContactHealth = (lastTouchAt: Date | null, now = new Date()): ContactHealth => {
  if (lastTouchAt === null) {
    return { status: "red", fillPct: 0, daysSinceLastTouch: null };
  }

  const daysSinceLastTouch = Math.max(0, Math.floor((now.getTime() - lastTouchAt.getTime()) / millisecondsPerDay));

  if (daysSinceLastTouch <= 7) {
    return { status: "green", fillPct: Math.max(70, 100 - daysSinceLastTouch * 4), daysSinceLastTouch };
  }

  if (daysSinceLastTouch <= 14) {
    return { status: "amber", fillPct: Math.max(35, 69 - (daysSinceLastTouch - 8) * 5), daysSinceLastTouch };
  }

  return { status: "red", fillPct: Math.max(0, 34 - (daysSinceLastTouch - 15) * 2), daysSinceLastTouch };
};
