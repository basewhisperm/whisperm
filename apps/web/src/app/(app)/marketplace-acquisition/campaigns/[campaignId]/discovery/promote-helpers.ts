export const PROMOTE_SUCCESS_MESSAGE = "Seller added to campaign.";
export const PROMOTE_GENERIC_FAILURE_MESSAGE = "Failed to add seller to campaign.";
export const PROMOTE_MISSING_CAPTURE_MESSAGE = "Promotion did not return a real capture id.";

/** ST1-006: canonical qualification/CRM-conversion statuses from the shared acquisition pipeline. */
export type CanonicalQualificationStatus = "QUALIFIED" | "UNQUALIFIED";
export type CanonicalCrmConversionStatus = "CREATED" | "EXISTING" | "NOT_ELIGIBLE";

export interface PromoteApiResult {
  readonly discoveredSellerId: string;
  readonly marketplaceCaptureId: string;
  readonly campaignMemberId: string | null;
  readonly alreadyPromoted: boolean;
  readonly qualificationStatus?: CanonicalQualificationStatus;
  readonly crmConversionStatus?: CanonicalCrmConversionStatus;
  readonly contactId?: string;
  readonly dealId?: string;
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

const promoteSuccessMessage = (data: PromoteApiResult): string =>
  data.qualificationStatus === "UNQUALIFIED"
    ? `${PROMOTE_SUCCESS_MESSAGE} Needs qualification (no phone on file).`
    : PROMOTE_SUCCESS_MESSAGE;

export const derivePromoteOutcome = (responseOk: boolean, payload: unknown): PromoteOutcome => {
  if (!responseOk) {
    const message = (payload as { error?: { message?: unknown } } | null)?.error?.message;
    return { success: false, message: isNonEmptyString(message) ? message : PROMOTE_GENERIC_FAILURE_MESSAGE };
  }

  const data = (payload as { data?: unknown } | null)?.data as Partial<PromoteApiResult> | undefined;
  if (data === undefined || !isNonEmptyString(data.marketplaceCaptureId)) {
    return { success: false, message: PROMOTE_MISSING_CAPTURE_MESSAGE };
  }

  const result: PromoteApiResult = {
    discoveredSellerId: data.discoveredSellerId ?? "",
    marketplaceCaptureId: data.marketplaceCaptureId,
    campaignMemberId: data.campaignMemberId ?? null,
    alreadyPromoted: data.alreadyPromoted === true,
    ...(data.qualificationStatus === "QUALIFIED" || data.qualificationStatus === "UNQUALIFIED" ? { qualificationStatus: data.qualificationStatus } : {}),
    ...(data.crmConversionStatus !== undefined ? { crmConversionStatus: data.crmConversionStatus } : {}),
    ...(isNonEmptyString(data.contactId) ? { contactId: data.contactId } : {}),
    ...(isNonEmptyString(data.dealId) ? { dealId: data.dealId } : {}),
  };

  return { success: true, message: promoteSuccessMessage(result), data: result };
};

/** ST1-006: a discovered seller is only invitation-ready once canonical qualification has succeeded and a Deal exists. */
export const isInviteEligible = (result: Pick<PromoteApiResult, "qualificationStatus" | "dealId"> | undefined): boolean =>
  result?.qualificationStatus === "QUALIFIED" && isNonEmptyString(result.dealId);

export const discoveryQualificationBadgeLabel = (status: CanonicalQualificationStatus | undefined): "Qualified" | "Needs Qualification" | null => {
  if (status === "QUALIFIED") return "Qualified";
  if (status === "UNQUALIFIED") return "Needs Qualification";
  return null;
};

export const crmConversionBadgeLabel = (status: CanonicalCrmConversionStatus | undefined): "CRM Converted" | null =>
  status === "CREATED" || status === "EXISTING" ? "CRM Converted" : null;

export const markSellerPromoted = <TSeller extends { readonly id: string; readonly status: string }>(
  sellers: readonly TSeller[],
  sellerId: string,
): readonly TSeller[] =>
  sellers.map((seller) => (seller.id === sellerId ? { ...seller, status: "PROMOTED" } : seller));
