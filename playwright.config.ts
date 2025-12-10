import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.TEST_PORT || process.env.OTC_DESK_PORT || process.env.VENDOR_OTC_DESK_PORT || '5005';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright configuration for UI E2E tests
 * App runs on port 5005 (OTC Desk - vendor port range)
 *
 * For local: Start the dev server manually with `bun run dev`
 * For CI: The workflow starts the server before running tests
 * 
 * Run: npx playwright test tests/ui.spec.ts
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts$/,
  testIgnore: [
    '**/node_modules/**',
    '**/contracts/lib/**',
    '**/contracts/test/**',
    '**/synpress/**',
    '**/wallet-setup/**',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI 
    ? [['html', { open: 'never' }], ['github']] 
    : [['html', { open: 'never' }], ['list']],
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Server must be started manually before running tests (bun run dev)
  // In CI, the workflow starts the server before running tests
  webServer: undefined,
});

