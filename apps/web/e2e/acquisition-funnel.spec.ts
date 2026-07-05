import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";
import { readAcquisitionSeedContext } from "./helpers/seed-context";
import { buildCapturePayload, intakeUrl } from "./helpers/capture-payload";
import { SMS_MOCK_PORT } from "./mocks/sms-server.mjs";

const smsMockUrl = (path: string) => `http://127.0.0.1:${SMS_MOCK_PORT}${path}`;

interface UsageSummary {
  readonly data: {
    readonly totals: readonly { readonly eventType: string; readonly quantity: number }[];
  };
}

const usageCount = (summary: UsageSummary, eventType: string): number =>
  summary.data.totals.find((total) => total.eventType === eventType)?.quantity ?? 0;

// ST1-011: golden-path regression proving the V1 acquisition funnel works end-to-end --
// Campaign -> Capture -> Qualification -> Membership -> Invitation -> Claim -> CRM Conversion
// -> Revenue Attribution -> Usage Metering -> Command Center -- in one repeatable test, so a
// broken handoff anywhere in the chain fails this test before it reaches demo or production.
test.describe("Acquisition funnel (golden path)", () => {
  test("campaign creation through revenue and usage visibility", async ({ page }) => {
    const credentials = e2eCredentials();
    const seed = readAcquisitionSeedContext();
    test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
    if (credentials === null || seed === null) return;

    await signIn(page, credentials);

    // 1-2. Authenticated tenant opens marketplace acquisition and uses the seeded campaign.
    await page.goto("/marketplace-acquisition/campaigns");
    await expect(page.getByText(seed.campaignName, { exact: true })).toBeVisible();

    const usageBefore = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;

    // 3-4. Capture a seller with a valid phone number through the real intake form.
    const phone = `+1555${Math.floor(1_000_000 + Math.random() * 8_000_000)}`;
    const { payload } = buildCapturePayload();
    await page.goto(intakeUrl(seed.campaignId, payload));
    await page.fill('[data-testid="intake-field-phone"]', phone);

    const captureResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/marketplace-acquisition/captures") && response.request().method() === "POST",
    );
    await page.click('[data-testid="intake-submit"]');
    const captureResponse = await captureResponsePromise;
    expect(captureResponse.ok()).toBeTruthy();
    const captureBody = await captureResponse.json();
    expect(captureBody.ok).toBe(true);
    const { captureId, contactId, dealId, qualificationStatus } = captureBody.data as {
      captureId: string; contactId: string; dealId: string; qualificationStatus: string;
    };

    // 4-5. Seller qualifies (valid phone present) and Contact/Deal are created (canonical CRM conversion).
    expect(qualificationStatus).toBe("QUALIFIED");
    expect(contactId).toBeTruthy();
    expect(dealId).toBeTruthy();
    await expect(page.getByTestId("capture-qualification-badge")).toHaveText("Qualified");
    await expect(page.getByTestId("result-row-contact")).toContainText("Created");
    await expect(page.getByTestId("result-row-deal")).toContainText("Created");

    // 6. Campaign membership exists for this capture.
    const membersResponse = await page.request.get(`/api/marketplace-acquisition/campaigns/${seed.campaignId}/members`);
    expect(membersResponse.ok()).toBeTruthy();
    const membersBody = await membersResponse.json();
    const member = (membersBody.data.members as readonly { readonly marketplaceCaptureId: string; readonly contactId: string | null; readonly dealId: string | null }[])
      .find((candidate) => candidate.marketplaceCaptureId === captureId);
    expect(member).toBeDefined();
    expect(member?.contactId).toBe(contactId);
    expect(member?.dealId).toBe(dealId);

    // Deal detail page reflects the captured state.
    await page.goto(`/marketplace-acquisition/${dealId}`);
    await expect(page.getByTestId("deal-stage-badge")).toHaveText("Captured");
    await expect(page.getByTestId("detail-capture-status")).toContainText("CAPTURED");

    // 7-8. Send the invitation through the sandbox SMS provider; the response is a truthful
    // COMPLETED/PENDING/FAILED outcome, never a false success.
    await page.click('[data-testid="channel-option-SMS"]');
    const inviteResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/invite") && response.request().method() === "POST",
    );
    await page.click('[data-testid="invite-send-button"]');
    const inviteResponse = await inviteResponsePromise;
    expect(inviteResponse.ok()).toBeTruthy();
    const inviteBody = await inviteResponse.json();
    expect(inviteBody.ok).toBe(true);
    expect(["COMPLETED", "PENDING"]).toContain(inviteBody.data.status);
    await expect(page.getByTestId("invite-status")).toHaveText("Seller invitation sent via SMS. Claim link expires in 7 days.");
    await expect(page.getByTestId("invite-status")).toHaveAttribute("data-failed", "false");

    // 9. Open the claim link the seller actually received via the sandbox SMS provider.
    const messagesResponse = await page.request.get(smsMockUrl(`/__control/messages?to=${encodeURIComponent(phone)}`));
    const messagesBody = await messagesResponse.json();
    expect(messagesBody.messages).toHaveLength(1);
    const claimUrl: string = messagesBody.messages[0].body;
    expect(claimUrl).toMatch(/\/claim\//);

    await page.goto(claimUrl);
    await expect(page.getByTestId("claim-stage")).toHaveText("Claim Started");

    // 10. Accept the claim.
    const acceptResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/accept") && response.request().method() === "POST",
    );
    await page.fill('[data-testid="claim-name-input"]', "E2E Seller Claimant");
    await page.check('[data-testid="claim-accept-checkbox"]');
    await page.click('[data-testid="claim-accept-button"]');
    const acceptResponse = await acceptResponsePromise;
    expect(acceptResponse.ok()).toBeTruthy();
    const acceptBody = await acceptResponse.json();
    expect(acceptBody.status).toBe("CLAIMED");
    await expect(page.getByTestId("claim-success")).toBeVisible();

    await page.goto(`/marketplace-acquisition/${dealId}`);
    await expect(page.getByTestId("deal-stage-badge")).toHaveText("Claimed");
    await expect(page.getByTestId("detail-capture-status")).toContainText("CLAIMED");

    // 11-12. Close the deal (mark revenue-eligible); revenue attribution executes.
    const stageResponse = await page.request.patch(`/api/marketplace-acquisition/deals/${dealId}/stage`, {
      data: { stageName: "Converted" },
    });
    expect(stageResponse.ok()).toBeTruthy();
    const stageBody = await stageResponse.json();
    expect(stageBody.data.revenueAttributed).toBe(true);
    expect(stageBody.data.attributedAmount).toBeTruthy();

    await page.goto(`/marketplace-acquisition/${dealId}`);
    await expect(page.getByTestId("deal-stage-badge")).toHaveText("Converted");
    await expect(page.getByTestId("detail-revenue-attributed")).not.toContainText("Not yet attributed");

    // 13. Command Center reflects the funnel/revenue state for this campaign.
    const commandCenterResponse = await page.request.get(
      `/api/marketplace-acquisition/command-center?campaignId=${seed.campaignId}`,
    );
    expect(commandCenterResponse.ok()).toBeTruthy();
    const commandCenterBody = await commandCenterResponse.json();
    expect(commandCenterBody.data.funnel.qualified).toBeGreaterThanOrEqual(1);
    expect(commandCenterBody.data.funnel.invited).toBeGreaterThanOrEqual(1);
    expect(commandCenterBody.data.funnel.claimed).toBeGreaterThanOrEqual(1);
    expect(commandCenterBody.data.funnel.crmConverted).toBeGreaterThanOrEqual(1);
    expect(commandCenterBody.data.funnel.dealsCreated).toBeGreaterThanOrEqual(1);
    expect(commandCenterBody.data.funnel.revenueAttributed).toBeGreaterThanOrEqual(1);
    expect(commandCenterBody.data.revenue.attributedRevenue).toBeGreaterThan(0);

    await page.goto("/marketplace-acquisition");
    await expect(page.getByTestId("command-center")).toBeVisible();

    // 14. Usage events were recorded for every billable step of this run.
    const usageAfter = (await (await page.request.get("/api/marketplace-acquisition/usage")).json()) as UsageSummary;
    expect(usageCount(usageAfter, "SELLER_QUALIFIED")).toBeGreaterThan(usageCount(usageBefore, "SELLER_QUALIFIED"));
    expect(usageCount(usageAfter, "CRM_CONVERSION_CREATED")).toBeGreaterThan(usageCount(usageBefore, "CRM_CONVERSION_CREATED"));
    expect(usageCount(usageAfter, "SELLER_CLAIMED")).toBeGreaterThan(usageCount(usageBefore, "SELLER_CLAIMED"));
    expect(usageCount(usageAfter, "REVENUE_ATTRIBUTED")).toBeGreaterThan(usageCount(usageBefore, "REVENUE_ATTRIBUTED"));
  });
});
