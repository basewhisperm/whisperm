import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('sign-up page does not ask for credit card', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(page.locator('input[autocomplete="cc-number"]')).not.toBeVisible();
    await expect(page.locator('input[autocomplete="cc-exp"]')).not.toBeVisible();
  });

  test('unauthenticated user is redirected to sign-in from dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/sign-in/);
  });

  test('unauthenticated user is redirected to sign-in from contacts', async ({ page }) => {
    await page.goto('/contacts');
    await expect(page).toHaveURL(/sign-in/);
  });

  test('sign-in page is reachable', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page).toHaveURL(/sign-in/);
  });
});
