#!/bin/bash
# Run all tests
# 
# Contract tests: Run directly with forge (no infrastructure needed)
# E2E tests: Vitest handles infrastructure setup/teardown automatically
#
# Set TEARDOWN_POSTGRES=true to also stop the database after tests

set -e

cd "$(dirname "$0")/.."

echo "Running all tests..."
echo ""

# ============================================
# 1. Contract Tests (no infrastructure needed)
# ============================================
echo "=== Contract Tests (Forge) ==="
cd contracts && forge test --summary
cd ..
echo ""

# ============================================
# 2. E2E Integration Tests (Vitest)
# ============================================
# Vitest automatically handles infrastructure via globalSetup/globalTeardown:
# - Starts PostgreSQL, Anvil, deploys contracts, starts Next.js
# - Runs all E2E tests
# - Tears down infrastructure when done
echo "=== E2E Integration Tests (Vitest) ==="
echo "Infrastructure will be started automatically..."
bun run vitest run tests/otc-e2e.test.ts
echo ""

echo "=== All Tests Complete ==="
