import { NextResponse } from "next/server";
import { getTenantForCurrentUser } from "@/lib/get-tenant";

export async function GET() {
  const tenant = await getTenantForCurrentUser();
  if (!tenant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ workspaces: [{ id: tenant.id, name: tenant.name, slug: tenant.slug }] });
}
