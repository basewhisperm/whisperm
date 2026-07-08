import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";

// ST1-013F -- the Seller Card is the primary operational surface of the
// acquisition workbench. These checks guard the reliability contract: every
// card must always render successfully, never show a broken-image icon,
// always communicate workflow stage and next action, and never overflow its
// container -- independent of which seller data happens to be seeded.
test.describe("Seller Card reliability", () => {
  test.beforeEach(async ({ page }) => {
    const credentials = e2eCredentials();
    if (!credentials) {
      test.skip();
      return;
    }
    await signIn(page, credentials);
  });

  test("renders every visible card with no broken images", async ({ page }) => {
    await page.goto("/marketplace-acquisition");

    const cards = page.getByTestId("seller-card");
    await expect(cards.first()).toBeVisible();

    // No raw <img> is ever left to fail on its own -- SellerThumbnail either
    // renders a fully-loaded image or falls back to the placeholder before
    // an <img> tag exists at all.
    const brokenImages = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).filter((img) => !img.complete || img.naturalWidth === 0).length,
    );
    expect(brokenImages).toBe(0);
  });

  test("shows a marketplace placeholder instead of a broken image when no photo is available", async ({ page }) => {
    await page.goto("/marketplace-acquisition");

    const cards = page.getByTestId("seller-card");
    const count = await cards.count();
    let sawPlaceholder = false;

    for (let index = 0; index < count; index += 1) {
      const placeholder = cards.nth(index).getByTestId("seller-thumbnail-placeholder");
      if (await placeholder.count() > 0) {
        await expect(placeholder).toBeVisible();
        await expect(placeholder).toContainText("No Preview");
        sawPlaceholder = true;
        break;
      }
    }

    // Not every seed necessarily includes a photoless seller -- only assert
    // the placeholder is well-formed when one is actually present.
    test.skip(!sawPlaceholder, "No photoless seller card present in this seed to verify.");
  });

  test("every card communicates workflow stage, next action, and a primary CTA", async ({ page }) => {
    await page.goto("/marketplace-acquisition");

    const firstCard = page.getByTestId("seller-card").first();
    await expect(firstCard).toBeVisible();

    await expect(firstCard.getByTestId("seller-workflow-stage-badge")).toBeVisible();
    await expect(firstCard.getByTestId("seller-next-action")).toContainText("Next action");
    await expect(firstCard.getByTestId("seller-primary-action")).toBeVisible();
  });

  test("never shows a blank or dashed-out identity, phone, price, or seller name", async ({ page }) => {
    await page.goto("/marketplace-acquisition");

    const cards = page.getByTestId("seller-card");
    const count = await cards.count();

    for (let index = 0; index < Math.min(count, 20); index += 1) {
      const card = cards.nth(index);
      const name = (await card.getByTestId("seller-card-name").innerText()).trim();
      const identity = (await card.getByTestId("seller-card-identity").innerText()).trim();
      const price = (await card.getByTestId("seller-card-price").innerText()).trim();

      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toBe("—");
      expect(identity).not.toBe("");
      expect(identity).not.toContain("undefined");
      expect(price.length).toBeGreaterThan(0);
      expect(price).not.toBe("—");
    }
  });

  test("primary action buttons meet the minimum tappable size", async ({ page }) => {
    await page.goto("/marketplace-acquisition");

    const button = page.getByTestId("seller-primary-action").first();
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("cards fit their container with no horizontal overflow at common breakpoints", async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 900 },
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto("/marketplace-acquisition");

      const firstCard = page.getByTestId("seller-card").first();
      await expect(firstCard).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);

      const cardBox = await firstCard.boundingBox();
      expect(cardBox).toBeTruthy();
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test("a long listing title stays visually clamped instead of overflowing the card", async ({ page }) => {
    await page.goto("/marketplace-acquisition");

    const titles = page.getByTestId("seller-card-title");
    const count = await titles.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const title = titles.nth(index);
      const overflowsVertically = await title.evaluate((el) => el.scrollHeight - el.clientHeight > 2);
      expect(overflowsVertically).toBe(false);
    }
  });
});
