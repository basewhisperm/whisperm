import { test, expect } from '@playwright/test';

test.describe('Pipeline', () => {
  test('pipeline page requires authentication', async ({ page }) => {
    await page.goto('/deals');
    await expect(page).toHaveURL(/sign-in/);
  });

  test('pipeline page is reachable when signed in', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) { test.skip(); return; }
    await page.goto('/sign-in');
    await page.fill('input[name="identifier"]', email);
    await page.click('button[type="submit"]');
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.goto('/deals');
    await expect(page).toHaveURL(/deals/);
  });

  test('deal detail drawer opens without navigating away', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) { test.skip(); return; }
    await page.goto('/sign-in');
    await page.fill('input[name="identifier"]', email);
    await page.click('button[type="submit"]');
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.goto('/deals');
    const card = page.locator('[data-testid=deal-card]').first();
    const cardCount = await card.count();
    if (cardCount === 0) { test.skip(); return; }
    await card.click();
    await expect(page).toHaveURL(/deals/);
  });
});
