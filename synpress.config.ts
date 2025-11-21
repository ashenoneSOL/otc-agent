import type { PlaywrightTestConfig } from '@playwright/test';

const OTC_DESK_PORT = parseInt(process.env.OTC_DESK_PORT || '3000');

// Stub implementations for missing config functions
function createSynpressConfig(options: {
  appName: string;
  port: number;
  testDir: string;
  overrides?: Record<string, unknown>;
}): PlaywrightTestConfig {
  return {
    testDir: options.testDir,
    timeout: options.overrides?.timeout as number || 30000,
    use: {
      baseURL: `http://localhost:${options.port}`,
    },
    webServer: options.overrides?.webServer as PlaywrightTestConfig['webServer'],
  };
}

function createWalletSetup() {
  return {
    walletPassword: process.env.METAMASK_PASSWORD || 'password123',
  };
}

// Export Playwright config
export default createSynpressConfig({
  appName: 'otc-desk',
  port: OTC_DESK_PORT,
  testDir: './tests/synpress',
  overrides: {
    timeout: 120000, // 2 minutes for OTC trading operations
    webServer: undefined, // Server must be started manually
  },
});

// Export wallet setup for Synpress
export const basicSetup = createWalletSetup();

