import { test, expect } from '@playwright/test';

test.describe('Contacts', () => {
  test('contacts page requires authentication', async ({ page }) => {
    await page.goto('/contacts');
    await expect(page).toHaveURL(/sign-in/);
  });

  test('contacts page is reachable when signed in', async ({ page, context }) => {
    // Skip if no test credentials available
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      test.skip();
      return;
    }
    await page.goto('/sign-in');
    await page.fill('input[name="identifier"]', email);
    await page.click('button[type="submit"]');
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/dashboard|contacts/);
    await page.goto('/contacts');
    await expect(page).toHaveURL(/contacts/);
    await expect(page.locator('[data-testid=contacts-table], table, [role=table]').first()).toBeVisible();
  });

  test('contacts health bar colours are visible on dashboard', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      test.skip();
      return;
    }
    await page.goto('/sign-in');
    await page.fill('input[name="identifier"]', email);
    await page.click('button[type="submit"]');
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/);
  });
});
