import { NextRequest, NextResponse } from "next/server";
import { SellerClaimPortalError } from "@whisperm/services";
import { createSellerClaimService } from "@/lib/claims/seller-claim-service";

interface RouteContext { readonly params: { readonly token: string } }
const correlation = (request: NextRequest) => ({ correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(), requestId: request.headers.get("x-request-id") ?? undefined });

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    const body = Number.isFinite(contentLength) && contentLength > 16_000
      ? {}
      : await request.json().catch(() => ({}));
    const result = await createSellerClaimService().accept({ correlation: correlation(request) }, params.token, body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "acceptedTerms must be true", code: "VALIDATION_ERROR" }, { status: 400 });
    if (error instanceof SellerClaimPortalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Claim acceptance failed" }, { status: 500 });
  }
}
