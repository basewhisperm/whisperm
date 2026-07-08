import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";
import { readAcquisitionSeedContext } from "./helpers/seed-context";

// ST1-013C: proves campaign targeting is a single canonical truth -- what the user saves in the
// create/edit form is exactly what the campaign card (and, after reload, a fresh page load) shows,
// with a runtime readiness state derived from that same saved targeting rather than guessed.
test.describe("Campaign targeting runtime truth", () => {
  test("campaign targeting persists and renders after reload", async ({ page }) => {
    const credentials = e2eCredentials();
    const seed = readAcquisitionSeedContext();
    test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
    if (credentials === null || seed === null) return;

    await signIn(page, credentials);
    await page.goto("/marketplace-acquisition/campaigns");

    const campaignName = `ST1-013C Demo Campaign ${Date.now()}`;

    await page.getByRole("button", { name: /new campaign/i }).click();
    await page.getByLabel(/campaign name/i).fill(campaignName);
    await page.getByLabel(/marketplace/i).fill("Jiji Ghana");
    await page.getByLabel(/keyword/i).fill("Toyota, Honda");
    await page.getByLabel(/location/i).fill("Accra");
    await page.getByLabel(/execution limit/i).fill("50");
    await page.getByRole("button", { name: /save campaign/i }).click();

    const card = page.locator("article", { has: page.getByRole("heading", { name: campaignName }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(/Jiji Ghana/i)).toBeVisible();
    await expect(card.getByText(/Toyota, Honda/i)).toBeVisible();
    await expect(card.getByText(/Accra/i)).toBeVisible();
    await expect(card.getByText(/Ready to run discovery/i)).toBeVisible();
    await expect(card.getByRole("link", { name: /run discovery/i })).toBeVisible();

    await page.reload();

    const cardAfterReload = page.locator("article", { has: page.getByRole("heading", { name: campaignName }) });
    await expect(cardAfterReload).toBeVisible();
    await expect(cardAfterReload.getByText(/Jiji Ghana/i)).toBeVisible();
    await expect(cardAfterReload.getByText(/Toyota, Honda/i)).toBeVisible();
    await expect(cardAfterReload.getByText(/Accra/i)).toBeVisible();
    await expect(cardAfterReload.getByText(/Ready to run discovery/i)).toBeVisible();

    // The workbench must never contradict the card: it reads the same canonical targeting.
    await cardAfterReload.getByRole("link", { name: /open workbench/i }).click();
    await expect(page.getByText(/Jiji Ghana/i)).toBeVisible();
    await expect(page.getByText(/Ready to run discovery/i)).toBeVisible();
  });

  test("campaign with no targeting shows what is missing, not a blanket label", async ({ page }) => {
    const credentials = e2eCredentials();
    const seed = readAcquisitionSeedContext();
    test.skip(credentials === null || seed === null, "E2E_USER_EMAIL/E2E_USER_PASSWORD are not configured for this run.");
    if (credentials === null || seed === null) return;

    await signIn(page, credentials);
    await page.goto("/marketplace-acquisition/campaigns");

    const campaignName = `ST1-013C Empty Campaign ${Date.now()}`;

    await page.getByRole("button", { name: /new campaign/i }).click();
    await page.getByLabel(/campaign name/i).fill(campaignName);
    await page.getByRole("button", { name: /save campaign/i }).click();

    const card = page.locator("article", { has: page.getByRole("heading", { name: campaignName }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(/^Not configured$/)).toBeVisible();
    await expect(card.getByText(/Missing marketplace and targeting criteria/i)).toBeVisible();
    await expect(card.getByRole("button", { name: /configure targeting/i })).toBeVisible();

    // Add only a marketplace: still not ready, but the missing reason narrows to targeting criteria.
    await card.getByRole("button", { name: /configure targeting/i }).click();
    await page.getByLabel(/marketplace/i).fill("Jiji Ghana");
    await page.getByRole("button", { name: /save campaign/i }).click();

    const updatedCard = page.locator("article", { has: page.getByRole("heading", { name: campaignName }) });
    await expect(updatedCard.getByText(/Missing targeting criteria/i)).toBeVisible();
  });
});
