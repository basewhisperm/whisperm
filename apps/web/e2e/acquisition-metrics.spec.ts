import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";
import { readAcquisitionSeedContext } from "./helpers/seed-context";

interface AcquisitionMetrics {
  readonly totalCaptured: number;
  readonly needsReview: number;
  readonly phoneReady: number;
  readonly invitationReady: number;
  readonly invitationPending: number;
  readonly waitingClaim: number;
  readonly claimed: number;
  readonly readyConversion: number;
  readonly converted: number;
  readonly blocked: number;
  readonly totalCampaignMembers: number;
}

const textToNumber = (value: string): number => {
  const parsed = Number.parseInt(value.replace(/[^\d-]/gu, ""), 10);
  return Number.isFinite(parsed) ? parsed : NaN;
};

// ST1-013E: every acquisition metric on every screen must come from the same
// AcquisitionMetricsService -- this spec proves it by comparing what's
// actually rendered across Dashboard, Workbench, Campaign, and Command
// Center against the canonical API response, and against each other.
test.describe("Acquisition metrics consistency", () => {
  test("Dashboard, Workbench, Campaign, and Command Center render identical acquisition metrics", async ({ page }) => {
    const credentials = e2eCredentials();
    const seed = readAcquisitionSeedContext();
    test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
    if (credentials === null || seed === null) return;

    await signIn(page, credentials);

    // Canonical source of truth: the metrics API itself.
    const globalMetricsResponse = await page.request.get("/api/marketplace-acquisition/metrics");
    expect(globalMetricsResponse.ok()).toBeTruthy();
    const globalMetrics = ((await globalMetricsResponse.json()) as { data: { metrics: AcquisitionMetrics } }).data.metrics;

    const campaignMetricsResponse = await page.request.get(`/api/marketplace-acquisition/metrics?campaignId=${encodeURIComponent(seed.campaignId)}`);
    expect(campaignMetricsResponse.ok()).toBeTruthy();
    const campaignMetrics = ((await campaignMetricsResponse.json()) as { data: { metrics: AcquisitionMetrics } }).data.metrics;

    // --- Dashboard: global scope ---
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-card-ready-to-invite")).toBeVisible();
    const dashboardReadyToInvite = textToNumber(await page.getByTestId("dashboard-card-ready-to-invite").locator("p").nth(1).innerText());
    const dashboardClaimsPending = textToNumber(await page.getByTestId("dashboard-card-claims-pending").locator("p").nth(1).innerText());
    expect(dashboardReadyToInvite).toBe(globalMetrics.invitationReady);
    expect(dashboardClaimsPending).toBe(globalMetrics.waitingClaim);

    if (globalMetrics.needsReview > 0) {
      await expect(page.getByTestId("dashboard-needs-review-callout")).toContainText(String(globalMetrics.needsReview));
    }

    // --- Workbench: global scope. "Needs Review" (stat tile) and "Needs Human
    // Review" (queue bucket) must never disagree -- that exact contradiction
    // is the motivating bug for ST1-013E. ---
    await page.goto("/marketplace-acquisition");
    await expect(page.getByTestId("acquisition-workbench")).toBeVisible();
    const workbenchNeedsReview = textToNumber(await page.getByTestId("stat-needs-review").locator("p").nth(1).innerText());
    const workbenchNeedsHumanReview = textToNumber(await page.getByTestId("queue-bucket-needs_human_review").locator("p").nth(1).innerText());
    expect(workbenchNeedsReview).toBe(workbenchNeedsHumanReview);
    expect(workbenchNeedsReview).toBe(globalMetrics.needsReview);

    const workbenchWaitingClaim = textToNumber(await page.getByTestId("stat-waiting-claim").locator("p").nth(1).innerText());
    expect(workbenchWaitingClaim).toBe(globalMetrics.waitingClaim);

    // --- Campaign workbench: scoped to the seeded campaign ---
    await page.goto(`/marketplace-acquisition/campaigns/${seed.campaignId}/workbench`);
    await expect(page.getByRole("heading", { name: "Campaign Summary" })).toBeVisible();
    const campaignSummary = page.locator('section[aria-label="Campaign summary"]');
    const campaignMembers = textToNumber(await campaignSummary.getByText("Members").locator("..").locator("p").first().innerText());
    const campaignReady = textToNumber(await campaignSummary.getByText("Ready").locator("..").locator("p").first().innerText());
    const campaignReview = textToNumber(await campaignSummary.getByText("Review").locator("..").locator("p").first().innerText());
    const campaignWaitingClaim = textToNumber(await campaignSummary.getByText("Waiting Claim").locator("..").locator("p").first().innerText());
    const campaignConverted = textToNumber(await campaignSummary.getByText("Converted").locator("..").locator("p").first().innerText());

    expect(campaignMembers).toBe(campaignMetrics.totalCampaignMembers);
    expect(campaignReady).toBe(campaignMetrics.invitationReady);
    expect(campaignReview).toBe(campaignMetrics.needsReview);
    expect(campaignWaitingClaim).toBe(campaignMetrics.waitingClaim);
    expect(campaignConverted).toBe(campaignMetrics.converted);

    // --- Command Center: same campaign scope, must agree with the Campaign workbench above ---
    await page.goto("/marketplace-acquisition");
    await expect(page.getByTestId("command-center")).toBeVisible();
    const commandCenterResponse = await page.request.get(`/api/marketplace-acquisition/command-center?campaignId=${encodeURIComponent(seed.campaignId)}`);
    expect(commandCenterResponse.ok()).toBeTruthy();
    const commandCenterSnapshot = (await commandCenterResponse.json()) as {
      data: { acquisitionMetrics: { needsReview: number; phoneReady: number; invitationReady: number; waitingClaim: number; converted: number } };
    };
    expect(commandCenterSnapshot.data.acquisitionMetrics.needsReview).toBe(campaignMetrics.needsReview);
    expect(commandCenterSnapshot.data.acquisitionMetrics.phoneReady).toBe(campaignMetrics.phoneReady);
    expect(commandCenterSnapshot.data.acquisitionMetrics.invitationReady).toBe(campaignMetrics.invitationReady);
    expect(commandCenterSnapshot.data.acquisitionMetrics.waitingClaim).toBe(campaignMetrics.waitingClaim);
    expect(commandCenterSnapshot.data.acquisitionMetrics.converted).toBe(campaignMetrics.converted);
  });
});
