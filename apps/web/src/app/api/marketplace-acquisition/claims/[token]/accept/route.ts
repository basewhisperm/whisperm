import { NextRequest, NextResponse } from "next/server";
import { SellerClaimPortalError } from "@whisperm/services";
import { createSellerClaimService } from "@/lib/claims/seller-claim-service";

interface RouteContext { readonly params: { readonly token: string } }
const correlation = (request: NextRequest) => ({ correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), requestId: request.headers.get("x-request-id") ?? undefined });

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const result = await createSellerClaimService().accept({ correlation: correlation(request) }, params.token, await request.json().catch(() => ({})));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "acceptedTerms must be true" }, { status: 400 });
    if (error instanceof SellerClaimPortalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Claim acceptance failed" }, { status: 500 });
  }
}
