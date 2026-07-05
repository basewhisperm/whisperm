import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";
import { readAcquisitionSeedContext } from "./helpers/seed-context";
import { buildCapturePayload } from "./helpers/capture-payload";
import { SMS_MOCK_PORT } from "./mocks/sms-server.mjs";

const smsMockUrl = (path: string) => `http://127.0.0.1:${SMS_MOCK_PORT}${path}`;

interface UsageSummary {
  readonly data: {
    readonly totals: readonly { readonly eventType: string; readonly quantity: number }[];
  };
}

const usageCount = (summary: UsageSummary, eventType: string): number =>
  summary.data.totals.find((total) => total.eventType === eventType)?.quantity ?? 0;

const randomPhone = () => `+1555${Math.floor(1_000_000 + Math.random() * 8_000_000)}`;

test.describe("Acquisition funnel (negative paths)", () => {
  test.beforeEach(async ({ page }) => {
    const credentials = e2eCredentials();
    const seed = readAcquisitionSeedContext();
    test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
    if (credentials === null || seed === null) return;
    await signIn(page, credentials);
  });

  // A. Capture without a phone number stays unqualified: no Contact/Deal, invite unavailable.
  test("A: capture without phone stays unqualified and invite is unavailable", async ({ page }) => {
    const seed = readAcquisitionSeedContext()!;
    const { payload } = buildCapturePayload();

    const captureResponse = await page.request.post("/api/marketplace-acquisition/captures", {
      data: { ...payload, campaignId: seed.campaignId },
    });
    expect(captureResponse.ok()).toBeTruthy();
    const captureBody = await captureResponse.json();
    expect(captureBody.data.qualificationStatus).toBe("UNQUALIFIED");
    expect(captureBody.data.qualificationReason).toBe("PHONE_REQUIRED");
    expect(captureBody.data.contactId).toBeUndefined();
    expect(captureBody.data.dealId).toBeUndefined();

    const inviteResponse = await page.request.post(
      `/api/marketplace-acquisition/captures/${captureBody.data.captureId}/invite`,
      { data: { preferredChannel: "SMS" } },
    );
    expect(inviteResponse.ok()).toBeFalsy();
    expect(inviteResponse.status()).toBe(422);
  });

  // B. Adding a phone later requalifies the same capture; no duplicate Contact/Deal is created.
  test("B: adding a phone later requalifies the seller and unlocks invitation", async ({ page }) => {
    const seed = readAcquisitionSeedContext()!;
    const { payload } = buildCapturePayload();

    const unqualified = await (await page.request.post("/api/marketplace-acquisition/captures", {
      data: { ...payload, campaignId: seed.campaignId },
    })).json();
    expect(unqualified.data.qualificationStatus).toBe("UNQUALIFIED");

    const requalified = await (await page.request.post("/api/marketplace-acquisition/captures", {
      data: { ...payload, campaignId: seed.campaignId, sellerPhone: randomPhone() },
    })).json();
    expect(requalified.data.captureId).toBe(unqualified.data.captureId);
    expect(requalified.data.qualificationStatus).toBe("QUALIFIED");
    expect(requalified.data.contactId).toBeTruthy();
    expect(requalified.data.dealId).toBeTruthy();

    const membersBody = await (await page.request.get(
      `/api/marketplace-acquisition/campaigns/${seed.campaignId}/members`,
    )).json();
    const membersForCapture = (membersBody.data.members as readonly { readonly marketplaceCaptureId: string }[])
      .filter((member) => member.marketplaceCaptureId === requalified.data.captureId);
    expect(membersForCapture).toHaveLength(1);

    const inviteResponse = await page.request.post(
      `/api/marketplace-acquisition/captures/${requalified.data.captureId}/invite`,
      { data: { preferredChannel: "SMS" } },
    );
    expect(inviteResponse.ok()).toBeTruthy();
  });

  // C. A provider outage produces a truthful failure: no false success, no usage event.
  test("C: invitation provider failure surfaces a safe error and records no usage", async ({ page }) => {
    const seed = readAcquisitionSeedContext()!;
    const { payload } = buildCapturePayload({ withPhone: true });

    const capture = await (await page.request.post("/api/marketplace-acquisition/captures", {
      data: { ...payload, campaignId: seed.campaignId },
    })).json();
    expect(capture.data.qualificationStatus).toBe("QUALIFIED");

    await page.request.post(smsMockUrl("/__control/reset"));
    await page.request.post(smsMockUrl("/__control/fail-next"));

    const usageBefore = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;

    const inviteResponse = await page.request.post(
      `/api/marketplace-acquisition/captures/${capture.data.captureId}/invite`,
      { data: { preferredChannel: "SMS" } },
    );
    expect(inviteResponse.ok()).toBeFalsy();
    const inviteBody = await inviteResponse.json();
    expect(inviteBody.ok).toBe(false);

    const usageAfter = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;
    expect(usageCount(usageAfter, "INVITATION_SENT")).toBe(usageCount(usageBefore, "INVITATION_SENT"));

    await page.goto(`/marketplace-acquisition/${capture.data.dealId}`);
    await expect(page.getByTestId("invitation-status-text").first()).not.toContainText("SENT");
  });

  // D. Repeating the qualification/capture action is idempotent: no duplicate Contact, Deal,
  // campaign membership, or usage count.
  test("D: repeating the qualification action is idempotent", async ({ page }) => {
    const seed = readAcquisitionSeedContext()!;
    const { payload } = buildCapturePayload({ withPhone: true });
    const body = { ...payload, campaignId: seed.campaignId };

    const usageBefore = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;

    const first = await (await page.request.post("/api/marketplace-acquisition/captures", { data: body })).json();
    expect(first.data.qualificationStatus).toBe("QUALIFIED");

    const usageAfterFirst = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;
    expect(usageCount(usageAfterFirst, "SELLER_QUALIFIED")).toBe(usageCount(usageBefore, "SELLER_QUALIFIED") + 1);
    expect(usageCount(usageAfterFirst, "CRM_CONVERSION_CREATED")).toBe(usageCount(usageBefore, "CRM_CONVERSION_CREATED") + 1);

    const second = await (await page.request.post("/api/marketplace-acquisition/captures", { data: body })).json();
    expect(second.data.captureId).toBe(first.data.captureId);
    expect(second.data.contactId).toBe(first.data.contactId);
    expect(second.data.dealId).toBe(first.data.dealId);

    const usageAfterSecond = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;
    expect(usageCount(usageAfterSecond, "SELLER_QUALIFIED")).toBe(usageCount(usageAfterFirst, "SELLER_QUALIFIED"));
    expect(usageCount(usageAfterSecond, "CRM_CONVERSION_CREATED")).toBe(usageCount(usageAfterFirst, "CRM_CONVERSION_CREATED"));

    const membersBody = await (await page.request.get(
      `/api/marketplace-acquisition/campaigns/${seed.campaignId}/members`,
    )).json();
    const membersForCapture = (membersBody.data.members as readonly { readonly marketplaceCaptureId: string }[])
      .filter((member) => member.marketplaceCaptureId === first.data.captureId);
    expect(membersForCapture).toHaveLength(1);
  });
});
