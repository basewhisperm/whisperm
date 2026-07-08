import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";
import { readAcquisitionSeedContext } from "./helpers/seed-context";
import {
  getCampaignWorkflowStageLabel,
  getNextCampaignWorkflowAction,
  getNextWorkflowAction,
} from "@whisperm/services/acquisition-workflow";

// ST1-013G — canonicalizes acquisition UX language across the Golden Path. This spec guards
// against regression back to ambiguous/generic terms ("New record", "Records", "Manage", "Go",
// "Submit") on the primary acquisition surfaces, and pins the canonical Golden Path vocabulary
// ("Acquisition Workbench", "Capture Seller", "Create Campaign", "Configure Targeting",
// "Run Discovery", "Review Sellers", "Send Invitation").
//
// This complements (does not duplicate) golden-path.spec.ts, which already walks the full
// capture -> invite -> claim -> convert funnel and asserts the workflow-cockpit CTA at each
// step. Two of the required labels here ("Review Sellers", "Send Invitation") only render once
// a campaign has captured members or a seller has an in-flight invitation -- state that spec
// already exercises. Rather than replay that same heavy funnel here, this spec pins those two
// labels at their single source of truth (the ST1-013D canonical resolvers every card/page/
// dossier reads from -- see workbench-domain.ts and seller-presentation.ts): if the resolver's
// wording drifts, this test fails exactly the same as a rendered-page assertion would, without
// re-deriving invitation/claim state that golden-path.spec.ts already owns.

const BANNED_LABEL_PATTERNS: readonly RegExp[] = [
  /^new record$/i,
  /^record$/i,
  /^records$/i,
  /^manage$/i,
  /^go$/i,
  /^submit$/i,
  /^open$/i,
  /^continue$/i,
  /^workbench$/i,
];

async function expectNoBannedLabels(page: Page): Promise<void> {
  for (const pattern of BANNED_LABEL_PATTERNS) {
    await expect(page.getByRole("button", { name: pattern })).toHaveCount(0);
    await expect(page.getByRole("link", { name: pattern })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: pattern })).toHaveCount(0);
  }
}

test.describe("Acquisition UX language (ST1-013G)", () => {
  test("canonical Golden Path CTAs are exact at their single source of truth", () => {
    // Every seller card, workbench dossier, and campaign card reads these resolvers directly
    // (never inventing its own wording) -- see workbench-domain.ts::workflowNextActionFromRecord,
    // seller-presentation.ts::present, and campaigns/page.tsx.
    expect(getNextWorkflowAction("DISCOVERY").label).toBe("Run Discovery");
    expect(getNextWorkflowAction("INVITATION_READY").label).toBe("Send Invitation");
    expect(getNextWorkflowAction("CLAIMED").label).toBe("Convert Seller");
    expect(getCampaignWorkflowStageLabel("SELLERS_CAPTURED")).toBe("Review Sellers");
    expect(getNextCampaignWorkflowAction("CONFIGURE_TARGETING").label).toBe("Configure Targeting");
    expect(getNextCampaignWorkflowAction("READY_FOR_DISCOVERY").label).toBe("Run Discovery");
  });

  test.describe("rendered pages", () => {
    test.beforeEach(async ({ page }) => {
      const credentials = e2eCredentials();
      const seed = readAcquisitionSeedContext();
      test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
      if (credentials === null || seed === null) return;

      await signIn(page, credentials);
    });

    test("/marketplace-acquisition uses canonical vocabulary", async ({ page }) => {
      await page.goto("/marketplace-acquisition");

      await expect(page.getByRole("heading", { name: "Acquisition Workbench" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Capture Seller" }).first()).toBeVisible();

      await expectNoBannedLabels(page);
    });

    test("/marketplace-acquisition/campaigns uses canonical vocabulary", async ({ page }) => {
      await page.goto("/marketplace-acquisition/campaigns");

      await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create Campaign" })).toBeVisible();

      // A freshly created campaign with no targeting must show "Configure Targeting" as its
      // primary CTA -- never a bare "Open" or "Manage".
      const untargetedName = `ST1-013G Untargeted ${Date.now()}`;
      await page.getByRole("button", { name: "Create Campaign" }).click();
      await page.getByLabel(/campaign name/i).fill(untargetedName);
      await page.getByRole("button", { name: /save campaign/i }).click();
      const untargetedCard = page.locator("article", { has: page.getByRole("heading", { name: untargetedName }) });
      await expect(untargetedCard.getByRole("button", { name: "Configure Targeting" })).toBeVisible();

      // A campaign with targeting configured and no members yet must show "Run Discovery".
      const targetedName = `ST1-013G Targeted ${Date.now()}`;
      await page.getByRole("button", { name: "Create Campaign" }).click();
      await page.getByLabel(/campaign name/i).fill(targetedName);
      await page.getByLabel(/marketplace/i).fill("Jiji Ghana");
      await page.getByLabel(/keyword/i).fill("Toyota");
      await page.getByRole("button", { name: /save campaign/i }).click();
      const targetedCard = page.locator("article", { has: page.getByRole("heading", { name: targetedName }) });
      await expect(targetedCard.getByRole("link", { name: "Run Discovery" })).toBeVisible();

      await expectNoBannedLabels(page);
    });

    test("campaign workbench uses canonical vocabulary", async ({ page }) => {
      const seed = readAcquisitionSeedContext();
      if (seed === null) return;

      await page.goto(`/marketplace-acquisition/campaigns/${seed.campaignId}/workbench`);

      await expect(page.getByRole("heading", { name: "Campaign Workbench" })).toBeVisible();
      await expectNoBannedLabels(page);
    });
  });
});
