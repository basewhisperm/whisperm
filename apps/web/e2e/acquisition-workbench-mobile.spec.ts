import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";

// ST1-013B: the Acquisition Workbench (search/filter panel, bulk invitation queue, and seller
// cards) previously overflowed the viewport at phone widths -- clipped search placeholder,
// edge-to-edge action buttons, cramped seller rows, and broken image icons. These checks guard
// the mobile-first layout fix at the workbench level, independent of acquisition business logic.
test.describe("Acquisition workbench mobile layout", () => {
  test.beforeEach(async ({ page }) => {
    const credentials = e2eCredentials();
    if (!credentials) {
      test.skip();
      return;
    }
    await signIn(page, credentials);
  });

  const hasHorizontalOverflow = (page: import("@playwright/test").Page) =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
  ] as const) {
    test(`renders without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/marketplace-acquisition");

      await expect(page.getByTestId("acquisition-workbench")).toBeVisible();
      await expect(page.getByRole("heading", { name: /acquisition workbench/i })).toBeVisible();

      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  }

  test.describe("mobile controls", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("keeps search, filter, and bulk invitation controls usable", async ({ page }) => {
      await page.goto("/marketplace-acquisition");

      const filterPanel = page.getByTestId("workbench-filter-panel");
      await expect(filterPanel).toBeVisible();
      await expect(filterPanel.getByPlaceholder(/search sellers/i)).toBeVisible();
      await expect(filterPanel.getByRole("button", { name: /refresh/i })).toBeVisible();
      await expect(filterPanel.getByRole("link", { name: /capture seller/i })).toBeVisible();

      const bulkQueue = page.getByTestId("bulk-invitation-queue");
      await expect(bulkQueue).toBeVisible();
      await expect(bulkQueue.getByText(/bulk invitation queue/i)).toBeVisible();
      await expect(bulkQueue.getByRole("button", { name: /select eligible|clear eligible/i })).toBeVisible();
      await expect(bulkQueue.getByRole("button", { name: /send invites/i })).toBeVisible();

      expect(await hasHorizontalOverflow(page)).toBe(false);
    });

    test("seller cards fit the viewport with no clipped text or broken images", async ({ page }) => {
      await page.goto("/marketplace-acquisition");

      const firstCard = page.getByTestId("seller-card").first();
      await expect(firstCard).toBeVisible();

      const cardBox = await firstCard.boundingBox();
      expect(cardBox).toBeTruthy();
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewportWidthWithTolerance(page));

      // No broken <img> -- every rendered image must have actually loaded.
      const brokenImages = await page.evaluate(() =>
        Array.from(document.querySelectorAll("img")).filter((img) => !img.complete || img.naturalWidth === 0).length,
      );
      expect(brokenImages).toBe(0);

      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
});

function viewportWidthWithTolerance(page: import("@playwright/test").Page): number {
  const size = page.viewportSize();
  return (size?.width ?? 390) + 1;
}
