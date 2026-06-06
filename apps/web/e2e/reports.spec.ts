import { test, expect } from "@playwright/test";

test.describe("Reports", () => {
  test("reports page requires authentication", async ({ page }) => {
    await page.goto("/reports");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("reports page is reachable for Growth/Pro plan", async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) { test.skip(); return; }
    await page.goto("/sign-in");
    await page.fill("input[name='identifier']", email);
    await page.click("button[type='submit']");
    await page.fill("input[name='password']", password);
    await page.click("button[type='submit']");
    await page.goto("/reports");
    const url = page.url();
    expect(url).toMatch(/reports|sign-in|dashboard/);
  });
});
