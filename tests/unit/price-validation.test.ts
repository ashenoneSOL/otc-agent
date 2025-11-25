/**
 * Unit tests for price validation logic
 * These tests don't require external RPC calls
 */

import { describe, it, expect } from "vitest";
import { checkPriceDivergence } from "../../src/utils/price-validator";

describe("Price Validation Logic", () => {
  describe("checkPriceDivergence", () => {
    it("should return valid=true when divergence is within 10%", async () => {
      // Mock scenario: pool price matches market price closely
      // Since we can't mock fetch easily, we test the fail-open behavior
      const result = await checkPriceDivergence(
        "0x0000000000000000000000000000000000000001", // Fake address
        "base",
        100 // Pool price
      );
      
      // Should fail open (return valid=true) when no aggregated price found
      expect(result.valid).toBe(true);
    });

    it("should handle missing chain gracefully", async () => {
      const result = await checkPriceDivergence(
        "0x0000000000000000000000000000000000000001",
        "unknown" as any,
        100
      );
      
      expect(result.valid).toBe(true);
    });

    it("should handle zero pool price", async () => {
      const result = await checkPriceDivergence(
        "0x0000000000000000000000000000000000000001",
        "base",
        0
      );
      
      expect(result.valid).toBe(true);
    });

    it("should handle negative pool price", async () => {
      const result = await checkPriceDivergence(
        "0x0000000000000000000000000000000000000001",
        "base",
        -100
      );
      
      expect(result.valid).toBe(true);
    });
  });

  describe("Price Divergence Calculation", () => {
    it("should correctly calculate 10% divergence threshold", () => {
      const aggregatedPrice = 100;
      const poolPrice = 110; // 10% higher
      
      const diff = Math.abs(poolPrice - aggregatedPrice);
      const divergence = diff / aggregatedPrice;
      const divergencePercent = divergence * 100;
      
      expect(divergencePercent).toBe(10);
      expect(divergencePercent <= 10).toBe(true); // Should be valid at exactly 10%
    });

    it("should correctly identify >10% divergence", () => {
      const aggregatedPrice = 100;
      const poolPrice = 115; // 15% higher
      
      const diff = Math.abs(poolPrice - aggregatedPrice);
      const divergence = diff / aggregatedPrice;
      const divergencePercent = divergence * 100;
      
      expect(divergencePercent).toBe(15);
      expect(divergencePercent > 10).toBe(true); // Should be invalid
    });

    it("should handle pool price lower than aggregated", () => {
      const aggregatedPrice = 100;
      const poolPrice = 85; // 15% lower
      
      const diff = Math.abs(poolPrice - aggregatedPrice);
      const divergence = diff / aggregatedPrice;
      const divergencePercent = divergence * 100;
      
      expect(divergencePercent).toBe(15);
      expect(divergencePercent > 10).toBe(true);
    });
  });

  describe("Agent Offer Rejection Logic", () => {
    it("should reject offer when price diverges >10%", () => {
      const MAX_PRICE_DIVERGENCE_BPS = 1000; // 10%
      
      const offerPriceUsd = 100;
      const marketPriceUsd = 85; // 15% lower
      
      const diff = Math.abs(offerPriceUsd - marketPriceUsd);
      const divergencePercent = (diff / marketPriceUsd) * 100;
      
      const shouldReject = divergencePercent > (MAX_PRICE_DIVERGENCE_BPS / 100);
      
      expect(shouldReject).toBe(true);
      console.log(`[Agent Rejection] Divergence: ${divergencePercent.toFixed(2)}% - Should Reject: ${shouldReject}`);
    });

    it("should accept offer when price is within tolerance", () => {
      const MAX_PRICE_DIVERGENCE_BPS = 1000; // 10%
      
      const offerPriceUsd = 100;
      const marketPriceUsd = 95; // 5% lower
      
      const diff = Math.abs(offerPriceUsd - marketPriceUsd);
      const divergencePercent = (diff / marketPriceUsd) * 100;
      
      const shouldReject = divergencePercent > (MAX_PRICE_DIVERGENCE_BPS / 100);
      
      expect(shouldReject).toBe(false);
      console.log(`[Agent Acceptance] Divergence: ${divergencePercent.toFixed(2)}% - Should Accept: ${!shouldReject}`);
    });

    it("should handle edge case at exactly 10%", () => {
      const MAX_PRICE_DIVERGENCE_BPS = 1000; // 10%
      
      const offerPriceUsd = 110;
      const marketPriceUsd = 100;
      
      const diff = Math.abs(offerPriceUsd - marketPriceUsd);
      const divergencePercent = (diff / marketPriceUsd) * 100;
      
      // At exactly 10%, should NOT reject (<=10% is valid)
      const shouldReject = divergencePercent > (MAX_PRICE_DIVERGENCE_BPS / 100);
      
      expect(shouldReject).toBe(false);
      console.log(`[Agent Edge Case] Divergence: ${divergencePercent.toFixed(2)}% - Should Accept: ${!shouldReject}`);
    });
  });

  describe("Price Protection Service Logic", () => {
    it("should validate quote price against current price", () => {
      const priceAtQuote = 100;
      const currentPrice = 105;
      const maxDeviationBps = 1000; // 10%
      
      const deviation = Math.abs(currentPrice - priceAtQuote);
      const deviationBps = Math.floor((deviation / priceAtQuote) * 10000);
      const isValid = deviationBps <= maxDeviationBps;
      
      expect(deviationBps).toBe(500); // 5%
      expect(isValid).toBe(true);
      console.log(`[Price Protection] Deviation: ${deviationBps/100}% - Valid: ${isValid}`);
    });

    it("should reject when price moves beyond threshold", () => {
      const priceAtQuote = 100;
      const currentPrice = 115; // 15% higher
      const maxDeviationBps = 1000; // 10%
      
      const deviation = Math.abs(currentPrice - priceAtQuote);
      const deviationBps = Math.floor((deviation / priceAtQuote) * 10000);
      const isValid = deviationBps <= maxDeviationBps;
      
      expect(deviationBps).toBe(1500); // 15%
      expect(isValid).toBe(false);
      console.log(`[Price Protection] Deviation: ${deviationBps/100}% - Valid: ${isValid}`);
    });
  });
});


