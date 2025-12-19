import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 180000, // 3 minutes per test
    hookTimeout: 180000, // 3 minutes for setup/teardown
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.next', 'src/**', 'tests/synpress/**', 'tests/wallet-setup/**', 'tests/**/*.spec.ts'],
    reporters: ['verbose'],
    sequence: {
      hooks: 'stack',
      // Run tests sequentially to avoid RPC rate limiting (429 errors)
      concurrent: false,
    },
    // Global setup/teardown for E2E infrastructure
    // Starts: PostgreSQL, Anvil, deploys contracts, Next.js
    // Stops: All processes after tests complete
    globalSetup: './tests/global-setup.ts',
    globalTeardown: './tests/global-teardown.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@elizaos/core': path.resolve(__dirname, './node_modules/@elizaos/core'),
    },
  },
});
