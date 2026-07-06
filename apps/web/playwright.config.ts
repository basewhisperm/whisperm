import { defineConfig, devices } from '@playwright/test';

// ST1-011: sandbox SMS provider the acquisition regression suite points the app at, so
// invitations never touch a real WhatsApp/SMS/email provider. See e2e/mocks/sms-server.mjs.
const smsMockPort = Number(process.env.E2E_SMS_MOCK_PORT ?? 4310);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

// ST1-011: when PLAYWRIGHT_BASE_URL points at a Vercel preview/staging deployment, Vercel
// Deployment Protection redirects every request to vercel.com/login before it ever reaches
// this app's own /sign-in -- Clerk never even gets a chance to run. Sending this header (a
// "Protection Bypass for Automation" secret, configured in Vercel and exported as an env var
// here, never hardcoded) satisfies Vercel's check so requests pass through to the real app.
// Undefined -- and therefore ignored by Playwright -- for local dev, where there's no
// deployment protection to bypass in the first place.
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: vercelBypassSecret
      ? {
          'x-vercel-protection-bypass': vercelBypassSecret,
        }
      : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: `node e2e/mocks/sms-server.mjs`,
      url: `http://127.0.0.1:${smsMockPort}/__control/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { E2E_SMS_MOCK_PORT: String(smsMockPort) },
    },
    {
      command: 'pnpm dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Force every acquisition invitation in this suite through the sandbox SMS provider
        // instead of the real Meta WhatsApp Cloud API or a live SMS gateway.
        SELLER_INVITATION_WHATSAPP_ENABLED: 'false',
        SELLER_INVITATION_SMS_API_URL: `http://127.0.0.1:${smsMockPort}/sms`,
        SELLER_INVITATION_SMS_API_KEY: 'e2e-mock-sms-key',
        SELLER_INVITATION_SMS_SENDER_ID: 'WHISPERM-E2E',
        // Claim links must resolve against this running app, not the production default.
        SELLER_INVITATION_BASE_URL: `${baseURL}/claim`,
      },
    },
  ],
});
