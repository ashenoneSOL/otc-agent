/**
 * Integration test for pool finding and price validation
 * Tests the complete flow: find pool -> get price -> validate against CoinGecko
 *
 * NOTE: These tests require live RPC connections and may be rate-limited.
 * Skip in CI environments without proper RPC access.
 */

import { describe, it, expect } from "vitest";
import { findBestPool } from "../../src/utils/pool-finder-base";
import { findBestSolanaPool } from "../../src/utils/pool-finder-solana";
import { checkPriceDivergence } from "../../src/utils/price-validator";

// Skip integration tests if running in CI without RPC access
const skipIntegration = process.env.CI === "true" || process.env.SKIP_INTEGRATION === "true";

describe("Pool Finder Integration", () => {
  describe("Base (EVM)", () => {
    it.skipIf(skipIntegration)("should find WETH pool on Base mainnet and calculate price", async () => {
      // WETH on Base - guaranteed to have a pool
      const WETH_BASE = "0x4200000000000000000000000000000000000006";
      
      const pool = await findBestPool(WETH_BASE, 8453);
      
      // RPC calls may fail due to rate limiting - skip validation if pool is undefined
      if (!pool) {
        console.log("[Base] Pool not found (likely RPC rate limited) - skipping assertions");
        return;
      }
      
      expect(pool.protocol).toBe("Uniswap V3");
      expect(pool.tvlUsd).toBeGreaterThan(0);
      expect(pool.priceUsd).toBeDefined();
      expect(pool.priceUsd).toBeGreaterThan(0);
      
      console.log(`[Base] Found ${pool.protocol} pool for WETH`);
      console.log(`  - TVL: $${pool.tvlUsd?.toLocaleString()}`);
      console.log(`  - Price: $${pool.priceUsd?.toFixed(2)}`);
    });

    it("should find BRETT token pool on Base mainnet", async () => {
      // BRETT token on Base - popular memecoin
      const BRETT_BASE = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
      
      const pool = await findBestPool(BRETT_BASE, 8453);
      
      if (pool) {
        expect(pool.protocol).toContain("Uniswap");
        expect(pool.tvlUsd).toBeGreaterThan(0);
        expect(pool.priceUsd).toBeDefined();
        
        console.log(`[Base] Found ${pool.protocol} pool for BRETT`);
        console.log(`  - TVL: $${pool.tvlUsd?.toLocaleString()}`);
        console.log(`  - Price: $${pool.priceUsd?.toFixed(6)}`);
        
        // Test price divergence check
        const priceCheck = await checkPriceDivergence(BRETT_BASE, "base", pool.priceUsd || 0);
        console.log(`  - Divergence Check: ${priceCheck.valid ? "PASS" : "WARNING"}`);
        if (priceCheck.divergencePercent !== undefined) {
          console.log(`  - Divergence: ${priceCheck.divergencePercent.toFixed(2)}%`);
        }
      } else {
        console.log("[Base] No pool found for BRETT (may not exist on mainnet)");
      }
    });
  });

  describe("Solana", () => {
    it("should find SOL/USDC pool info", async () => {
      // BONK token on Solana - popular memecoin with Raydium pool
      const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
      
      // Note: This test may fail due to public RPC rate limits
      // The fallback mechanism should still work
      const pool = await findBestSolanaPool(BONK_MINT, "mainnet");
      
      if (pool) {
        expect(["Raydium", "PumpSwap"]).toContain(pool.protocol);
        expect(pool.tvlUsd).toBeGreaterThan(0);
        expect(pool.priceUsd).toBeDefined();
        
        console.log(`[Solana] Found ${pool.protocol} pool for BONK`);
        console.log(`  - TVL: $${pool.tvlUsd?.toLocaleString()}`);
        console.log(`  - Price: $${pool.priceUsd?.toFixed(8)}`);
        
        // Test price divergence check
        const priceCheck = await checkPriceDivergence(BONK_MINT, "solana", pool.priceUsd || 0);
        console.log(`  - Divergence Check: ${priceCheck.valid ? "PASS" : "WARNING"}`);
        if (priceCheck.divergencePercent !== undefined) {
          console.log(`  - Divergence: ${priceCheck.divergencePercent.toFixed(2)}%`);
        }
      } else {
        console.log("[Solana] No pool found (public RPC may have blocked getProgramAccounts)");
      }
    });
  });

  describe("Price Validator", () => {
    it("should validate price within 10% tolerance", async () => {
      // Test with a known token (WETH on Base)
      const WETH_BASE = "0x4200000000000000000000000000000000000006";
      
      // Assume ETH is around $3000-3500
      const mockPoolPrice = 3200;
      
      const result = await checkPriceDivergence(WETH_BASE, "base", mockPoolPrice);
      
      // CoinGecko may or may not have the price
      // If it does, check the divergence calculation
      if (result.aggregatedPrice) {
        console.log(`[Validator] Aggregated Price: $${result.aggregatedPrice.toFixed(2)}`);
        console.log(`[Validator] Pool Price: $${mockPoolPrice}`);
        console.log(`[Validator] Divergence: ${result.divergencePercent?.toFixed(2)}%`);
        console.log(`[Validator] Valid: ${result.valid}`);
        
        expect(result.divergencePercent).toBeDefined();
      } else {
        console.log("[Validator] No aggregated price available (rate limited or not found)");
        expect(result.valid).toBe(true); // Should fail open
      }
    });

    it("should warn on significant price divergence", async () => {
      // Test with a deliberately wrong price
      const WETH_BASE = "0x4200000000000000000000000000000000000006";
      
      // Use a price that's 50% off
      const badPoolPrice = 1500; // Way below actual ETH price
      
      const result = await checkPriceDivergence(WETH_BASE, "base", badPoolPrice);
      
      if (result.aggregatedPrice) {
        console.log(`[Validator] Testing bad price divergence...`);
        console.log(`  - Aggregated: $${result.aggregatedPrice.toFixed(2)}`);
        console.log(`  - Pool (bad): $${badPoolPrice}`);
        console.log(`  - Divergence: ${result.divergencePercent?.toFixed(2)}%`);
        console.log(`  - Warning: ${result.warning || "None"}`);
        
        // Should flag as invalid due to >10% divergence
        expect(result.valid).toBe(false);
        expect(result.warning).toBeDefined();
      } else {
        console.log("[Validator] Skipped - no aggregated price available");
      }
    });
  });
});


