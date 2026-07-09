import type { PrismaClient } from "@prisma/client";

export type InvitationEligibility =
  | {
      readonly eligible: true;
      readonly captureId: string;
      readonly campaignId: string;
      readonly executionId?: string;
      readonly reason: "READY";
    }
  | {
      readonly eligible: false;
      readonly captureId: string;
      readonly code:
        | "CAPTURE_NOT_FOUND"
        | "CAPTURE_NOT_QUALIFIED"
        | "MISSING_CONTACT"
        | "MISSING_CONTACT_CHANNEL"
        | "MISSING_CAMPAIGN_CONTEXT"
        | "ALREADY_INVITED"
        | "ALREADY_CLAIMED"
        | "PROVIDER_NOT_CONFIGURED";
      readonly message: string;
    };

export type InvitationChannel = "WHATSAPP" | "SMS" | "EMAIL";

type EligibilityPrisma = Pick<PrismaClient, "marketplaceCapture">;

const activeInvitationStatuses = new Set(["PENDING", "SENT", "DELIVERED", "MANUAL_DELIVERY_REQUIRED"]);
const claimedTokenStatuses = new Set(["CLAIMED", "ACCEPTED"]);
const unqualifiedCaptureStatuses = new Set(["UNQUALIFIED", "DISQUALIFIED", "REJECTED", "BLOCKED"]);

const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asRecord = (value: unknown): Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};

const contactValueForChannel = (
  channel: InvitationChannel,
  capture: {
    readonly metadata: unknown;
    readonly contact: { readonly phone: string | null; readonly email: string | null } | null;
  },
): string | null => {
  const metadata = asRecord(capture.metadata);
  if (channel === "EMAIL") return text(capture.contact?.email) ?? text(metadata.sellerEmail) ?? text(metadata.email);
  return text(capture.contact?.phone) ?? text(metadata.sellerPhone) ?? text(metadata.phone) ?? text(metadata.primaryPhoneNumber);
};

export async function resolveInvitationEligibility(
  prisma: EligibilityPrisma,
  input: { readonly tenantId: string; readonly captureId: string; readonly channel: InvitationChannel },
): Promise<InvitationEligibility> {
  const capture = await prisma.marketplaceCapture.findFirst({
    where: { tenantId: input.tenantId, id: input.captureId },
    select: {
      id: true,
      status: true,
      metadata: true,
      contactId: true,
      contact: { select: { phone: true, email: true } },
      campaignMemberships: {
        where: { tenantId: input.tenantId, removedAt: null },
        select: { campaignId: true },
        orderBy: { assignedAt: "desc" },
        take: 1,
      },
      sellerInvitations: {
        where: { tenantId: input.tenantId },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      claimTokens: {
        where: { tenantId: input.tenantId },
        select: { status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (capture === null) {
    return { eligible: false, captureId: input.captureId, code: "CAPTURE_NOT_FOUND", message: "Capture was not found." };
  }

  const latestClaimToken = capture.claimTokens[0];
  if (latestClaimToken !== undefined && claimedTokenStatuses.has(latestClaimToken.status)) {
    return { eligible: false, captureId: capture.id, code: "ALREADY_CLAIMED", message: "Seller has already claimed this capture." };
  }

  const latestInvitation = capture.sellerInvitations[0];
  if (latestInvitation !== undefined && activeInvitationStatuses.has(latestInvitation.status)) {
    return { eligible: false, captureId: capture.id, code: "ALREADY_INVITED", message: "Seller already has an active invitation." };
  }

  if (unqualifiedCaptureStatuses.has(capture.status)) {
    return { eligible: false, captureId: capture.id, code: "CAPTURE_NOT_QUALIFIED", message: "Capture is not qualified for invitation." };
  }

  if (capture.contactId === null && contactValueForChannel(input.channel, capture) === null) {
    return { eligible: false, captureId: capture.id, code: "MISSING_CONTACT", message: "Seller contact is required before sending an invitation." };
  }

  if (contactValueForChannel(input.channel, capture) === null) {
    return { eligible: false, captureId: capture.id, code: "MISSING_CONTACT_CHANNEL", message: "Seller is missing a supported contact channel for this invitation." };
  }

  const campaignId = capture.campaignMemberships[0]?.campaignId;
  if (campaignId === undefined) {
    return { eligible: false, captureId: capture.id, code: "MISSING_CAMPAIGN_CONTEXT", message: "Assign this seller to a campaign before sending an invitation." };
  }

  return { eligible: true, captureId: capture.id, campaignId, reason: "READY" };
}

export const invitationEligibilityHttpStatus = (eligibility: Exclude<InvitationEligibility, { readonly eligible: true }>): number => {
  if (eligibility.code === "CAPTURE_NOT_FOUND") return 404;
  if (eligibility.code === "PROVIDER_NOT_CONFIGURED") return 503;
  if (eligibility.code === "ALREADY_INVITED" || eligibility.code === "ALREADY_CLAIMED") return 409;
  return 422;
};
