export const PROMOTE_SUCCESS_MESSAGE = "Seller added to campaign.";
export const PROMOTE_GENERIC_FAILURE_MESSAGE = "Failed to add seller to campaign.";
export const PROMOTE_MISSING_CAPTURE_MESSAGE = "Promotion did not return a real capture id.";

export interface PromoteApiResult {
  readonly discoveredSellerId: string;
  readonly marketplaceCaptureId: string;
  readonly campaignMemberId: string | null;
  readonly alreadyPromoted: boolean;
}

export interface PromoteOutcome {
  readonly success: boolean;
  readonly message: string;
  readonly data?: PromoteApiResult;
}

export const promoteEndpoint = (campaignId: string, sellerId: string): string =>
  `/api/marketplace-acquisition/campaigns/${campaignId}/discovery/sellers/${sellerId}/promote`;

// ST-002: the promote endpoint takes the discovered-seller id from the URL only;
// it must never receive a captureId, since discovered sellers are not captures.
export const buildPromoteRequestInit = (): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
});

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export const derivePromoteOutcome = (responseOk: boolean, payload: unknown): PromoteOutcome => {
  if (!responseOk) {
    const message = (payload as { error?: { message?: unknown } } | null)?.error?.message;
    return { success: false, message: isNonEmptyString(message) ? message : PROMOTE_GENERIC_FAILURE_MESSAGE };
  }

  const data = (payload as { data?: unknown } | null)?.data as Partial<PromoteApiResult> | undefined;
  if (data === undefined || !isNonEmptyString(data.marketplaceCaptureId)) {
    return { success: false, message: PROMOTE_MISSING_CAPTURE_MESSAGE };
  }

  return {
    success: true,
    message: PROMOTE_SUCCESS_MESSAGE,
    data: {
      discoveredSellerId: data.discoveredSellerId ?? "",
      marketplaceCaptureId: data.marketplaceCaptureId,
      campaignMemberId: data.campaignMemberId ?? null,
      alreadyPromoted: data.alreadyPromoted === true,
    },
  };
};

export const markSellerPromoted = <TSeller extends { readonly id: string; readonly status: string }>(
  sellers: readonly TSeller[],
  sellerId: string,
): readonly TSeller[] =>
  sellers.map((seller) => (seller.id === sellerId ? { ...seller, status: "PROMOTED" } : seller));
