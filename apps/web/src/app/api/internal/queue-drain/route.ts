import { NextResponse, type NextRequest } from "next/server";

import { drainDueQueueJobs } from "@/lib/queue-drain/drain";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drains the durable QueueJob table for every tenant with due work -- see
 * apps/web/src/lib/queue-drain/drain.ts. Nothing in this repo's deployment keeps apps/worker
 * running continuously, so without something invoking this route on a schedule, claim expiry
 * (7-day claim links), claim reminders (Day 3/Day 6), and growth-loop evaluation silently never
 * run. Wired to Vercel Cron in apps/web/vercel.json.
 *
 * Requires CRON_SECRET -- Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * once that env var is set (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Fails closed: with no CRON_SECRET configured, this route refuses every request rather than
 * running an unauthenticated internal endpoint.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await drainDueQueueJobs();
  return NextResponse.json({ ok: true, ...result });
}
