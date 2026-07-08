import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";
import { readAcquisitionSeedContext } from "./helpers/seed-context";
import { buildCapturePayload, intakeUrl } from "./helpers/capture-payload";
import { SMS_MOCK_PORT } from "./mocks/sms-server.mjs";
import { ALLOWED_ACQUISITION_CTA_LABELS } from "@whisperm/services/acquisition-workflow";

const smsMockUrl = (path: string) => `http://127.0.0.1:${SMS_MOCK_PORT}${path}`;

// ST1-013D — canonical Golden Path orchestration: every screen in the acquisition
// experience must expose (1) current lifecycle stage, (2) the single next required
// action, and (3) why progress is blocked when it is. This spec walks the same
// funnel as acquisition-funnel.spec.ts but asserts on the *workflow cockpit* UI
// itself (stage badges, canonical CTA wording) rather than the underlying data,
// so a page that regresses to ambiguous/ad-hoc wording fails here first.
test.describe("Canonical acquisition Golden Path", () => {
  test("current stage and next action are visible and canonical at every step", async ({ page }) => {
    const credentials = e2eCredentials();
    const seed = readAcquisitionSeedContext();
    test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
    if (credentials === null || seed === null) return;

    await signIn(page, credentials);

    // Campaign: the campaign list must show a current stage and a canonical next
    // action for the seeded campaign -- never a bare "Open".
    await page.goto("/marketplace-acquisition/campaigns");
    const campaignCard = page.locator("article", { hasText: seed.campaignName });
    await expect(campaignCard).toBeVisible();
    await expect(campaignCard.getByTestId("campaign-workflow-stage")).toBeVisible();
    const campaignNextAction = await campaignCard.getByTestId("campaign-workflow-next-action").innerText();
    for (const forbidden of ["Open\n", "Go\n", "Continue\n", "Manage\n"]) {
      expect(campaignNextAction).not.toContain(forbidden.trim());
    }

    // Capture a seller with a phone number through the real intake form.
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
    const { dealId } = (await captureResponse.json()).data as { dealId: string };

    // Seller detail cockpit: a qualified, phone-ready capture must show the
    // workflow progress cockpit with "Queue Invitation" as the next action.
    await page.goto(`/marketplace-acquisition/${dealId}`);
    const cockpit = page.getByTestId("workflow-progress");
    await expect(cockpit).toBeVisible();
    const nextActionAfterCapture = await page.getByTestId("workflow-next-action").innerText();
    expect(ALLOWED_ACQUISITION_CTA_LABELS as readonly string[]).toContain(nextActionAfterCapture);
    expect(nextActionAfterCapture).toBe("Queue Invitation");

    // Send the invitation; the cockpit must advance and describe the wait state
    // with the canonical "Monitor Claim" wording, never a raw status enum.
    await page.click('[data-testid="channel-option-SMS"]');
    const inviteResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/invite") && response.request().method() === "POST",
    );
    await page.click('[data-testid="invite-send-button"]');
    await inviteResponsePromise;

    await page.goto(`/marketplace-acquisition/${dealId}`);
    const nextActionAfterInvite = await page.getByTestId("workflow-next-action").innerText();
    expect(ALLOWED_ACQUISITION_CTA_LABELS as readonly string[]).toContain(nextActionAfterInvite);
    expect(nextActionAfterInvite).toBe("Monitor Claim");

    // Open the claim link the seller received and accept the claim.
    const messagesResponse = await page.request.get(smsMockUrl(`/__control/messages?to=${encodeURIComponent(phone)}`));
    const messagesBody = await messagesResponse.json();
    const claimUrl: string = messagesBody.messages[0].body;
    await page.goto(claimUrl);
    await page.fill('[data-testid="claim-name-input"]', "E2E Golden Path Claimant");
    await page.check('[data-testid="claim-accept-checkbox"]');
    const acceptResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/accept") && response.request().method() === "POST",
    );
    await page.click('[data-testid="claim-accept-button"]');
    await acceptResponsePromise;

    // Claimed: the cockpit must now recommend "Convert Seller" -- the canonical
    // CTA for moving a claimed seller toward CRM conversion.
    await page.goto(`/marketplace-acquisition/${dealId}`);
    const nextActionAfterClaim = await page.getByTestId("workflow-next-action").innerText();
    expect(ALLOWED_ACQUISITION_CTA_LABELS as readonly string[]).toContain(nextActionAfterClaim);
    expect(nextActionAfterClaim).toBe("Convert Seller");
    await expect(page.getByTestId("workflow-blockers")).toHaveCount(0);
  });
});
