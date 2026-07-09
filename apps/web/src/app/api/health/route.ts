import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// ST1-013L: minimal, public, unauthenticated readiness endpoint (see middleware.ts -- this
// route is explicitly excluded from Clerk auth so load balancers/uptime monitors can poll it).
// Never returns tenant data, session data, or any error detail that could carry connection-string
// secrets -- only a coarse "ok"/"error" database status. Always resolves (never throws), so it is
// safe for a health check to call this repeatedly without special error handling.
export async function GET() {
  const timestamp = new Date().toISOString();

  let database: "ok" | "error" = "error";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "ok";
  } catch {
    database = "error";
  }

  const ok = database === "ok";

  return NextResponse.json(
    { ok, service: "web", database, timestamp },
    { status: ok ? 200 : 503 },
  );
}
