import { test, expect } from "@playwright/test";

import { e2eCredentials, signIn } from "./helpers/auth";

// ST1-013A: the mobile app shell (Sidebar + TopBar) previously rendered the hamburger/menu
// button as a `position: fixed` element sitting on top of page content, so it visually
// covered the page title on every route. These checks protect the fix at the shell level --
// they assert on the nav control and heading geometry, not on any page's business logic.
test.use({ viewport: { width: 390, height: 844 } });

const MOBILE_SHELL_ROUTES = [
  "/marketplace-acquisition",
  "/marketplace-acquisition/campaigns",
  "/contacts",
  "/dashboard",
] as const;

test.describe("Mobile app shell", () => {
  test.beforeEach(async ({ page }) => {
    const credentials = e2eCredentials();
    if (!credentials) {
      test.skip();
      return;
    }
    await signIn(page, credentials);
  });

  for (const route of MOBILE_SHELL_ROUTES) {
    test(`${route}: no horizontal overflow, and the menu button does not cover the page heading`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(route.replace(/\//g, "\\/")));

      const heading = page.getByRole("heading").first();
      await expect(heading).toBeVisible();

      const menu = page.getByRole("button", { name: /menu|navigation|open/i }).first();
      await expect(menu).toBeVisible();

      const headingBox = await heading.boundingBox();
      const menuBox = await menu.boundingBox();
      expect(headingBox).toBeTruthy();
      expect(menuBox).toBeTruthy();

      const overlaps =
        headingBox!.x < menuBox!.x + menuBox!.width &&
        headingBox!.x + headingBox!.width > menuBox!.x &&
        headingBox!.y < menuBox!.y + menuBox!.height &&
        headingBox!.y + headingBox!.height > menuBox!.y;
      expect(overlaps).toBe(false);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }

  test("the drawer opens above content, closes on overlay click, and never widens the document", async ({ page }) => {
    await page.goto("/dashboard");

    const menu = page.getByRole("button", { name: /menu|navigation|open/i }).first();
    await menu.click();

    const drawer = page.locator("#mobile-primary-navigation");
    await expect(drawer).toBeVisible();

    const overflowWhileOpen = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowWhileOpen).toBe(false);

    // Click the overlay, not the drawer itself, to close.
    await page.mouse.click(370, 20);
    await expect(drawer).toBeHidden();
  });
});
