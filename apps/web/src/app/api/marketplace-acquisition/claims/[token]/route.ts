import { NextRequest, NextResponse } from "next/server";
import { SellerClaimPortalError } from "@whisperm/services";
import { createSellerClaimService } from "@/lib/claims/seller-claim-service";

interface RouteContext { readonly params: { readonly token: string } }
const correlation = (request: NextRequest) => ({ correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), requestId: request.headers.get("x-request-id") ?? undefined });

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const preview = await createSellerClaimService().preview({ correlation: correlation(request) }, params.token);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof SellerClaimPortalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Malformed claim token", code: "VALIDATION_ERROR" }, { status: 400 });
    return NextResponse.json({ error: "Claim preview failed" }, { status: 500 });
  }
}
