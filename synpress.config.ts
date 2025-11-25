import { defineConfig, devices } from '@playwright/test';

const OTC_DESK_PORT = parseInt(process.env.OTC_DESK_PORT || '5004');
const BASE_URL = `http://localhost:${OTC_DESK_PORT}`;

/**
 * Synpress + Playwright configuration for wallet-based E2E tests
 * 
 * These tests use real MetaMask wallets to test:
 * - Wallet connection flows
 * - Order creation with transaction signing
 * - Two-party trading (buyer + seller)
 */
export default defineConfig({
  testDir: './tests/synpress',
  testMatch: /.*\.(test|spec)\.ts$/,
  
  // Run tests serially - wallet tests need isolation
  fullyParallel: false,
  workers: 1,
  
  // Longer timeouts for wallet interactions
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  
  // Fail fast in CI
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    
    // Longer timeouts for wallet operations
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  
  projects: [
    {
      name: 'chromium-synpress',
      use: { 
        ...devices['Desktop Chrome'],
        // Required for MetaMask extension
        launchOptions: {
          args: ['--disable-web-security'],
        },
      },
    },
  ],
  
  // Don't auto-start server - must be running already with contracts deployed
  webServer: undefined,
});
