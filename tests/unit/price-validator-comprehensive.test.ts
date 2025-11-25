/**
 * Comprehensive Price Validator Tests
 * Tests the full price validation flow with mocked CoinGecko responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPriceDivergence } from "../../src/utils/price-validator";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("Price Validator - Comprehensive", () => {
  beforeEach(() => {

});

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  describe("CoinGecko Integration", () => {
    it("should detect price divergence >10% and return warning", async () => {
      // Mock CoinGecko response with market price $100
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          "0x4200000000000000000000000000000000000006": { usd: 100 },
        }),
      })) as typeof fetch;

      const result = await checkPriceDivergence(
        "0x4200000000000000000000000000000000000006",
        "base",
        115, // Pool price $115 (15% divergence)
      );

      expect(result.valid).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.divergencePercent).toBeCloseTo(15, 0);
      expect(result.aggregatedPrice).toBe(100);
      expect(result.poolPrice).toBe(115);

      console.log("[CoinGecko Test] Result:", {
        valid: result.valid,
        divergence: result.divergencePercent?.toFixed(2) + "%",
        warning: result.warning,
      });
    });

    it("should accept price within 10% tolerance", async () => {
      // Mock CoinGecko response with market price $100
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          "0x4200000000000000000000000000000000000006": { usd: 100 },
        }),
      })) as typeof fetch;

      const result = await checkPriceDivergence(
        "0x4200000000000000000000000000000000000006",
        "base",
        105, // Pool price $105 (5% divergence)
      );

      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(result.divergencePercent).toBeCloseTo(5, 0);

      console.log("[CoinGecko Test] Result:", {
        valid: result.valid,
        divergence: result.divergencePercent?.toFixed(2) + "%",
      });
    });

    it("should handle CoinGecko rate limit (429) gracefully", async () => {
      // Mock CoinGecko returning 429 (after retries fail)
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      })) as typeof fetch;

      const result = await checkPriceDivergence(
        "0x4200000000000000000000000000000000000006",
        "base",
        100,
      );

      // Should fail open (return valid=true)
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();

      console.log("[CoinGecko 429 Test] Fail-open behavior:", result.valid);
    });

    it("should handle token not found on CoinGecko", async () => {
      // Mock CoinGecko returning empty object (token not found)
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({}),
      })) as typeof fetch;

      const result = await checkPriceDivergence("0xunknowntoken", "base", 100);

      // Should fail open
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();

      console.log(
        "[CoinGecko Not Found Test] Fail-open behavior:",
        result.valid,
      );
    });
  });

  describe("Chain Support", () => {
    it("should support Base chain", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ "0xtest": { usd: 100 } }),
      })) as typeof fetch;

      const result = await checkPriceDivergence("0xtest", "base", 100);
      expect(result.valid).toBe(true);
    });

    it("should support Solana chain", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ solanatoken: { usd: 50 } }),
      })) as typeof fetch;

      const result = await checkPriceDivergence("solanatoken", "solana", 50);
      expect(result.valid).toBe(true);
    });

    it("should return valid for unsupported chains", async () => {
      // "jeju" is not in CoinGecko map
      const result = await checkPriceDivergence("0xtest", "jeju", 100);
      expect(result.valid).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle network errors gracefully", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("Network error");
      }) as typeof fetch;

      const result = await checkPriceDivergence("0xtest", "base", 100);
      expect(result.valid).toBe(true); // Fail open
    });

    it("should handle malformed JSON response", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      })) as typeof fetch;

      const result = await checkPriceDivergence("0xtest", "base", 100);
      expect(result.valid).toBe(true); // Fail open
    });

    it("should handle exactly 10% divergence as valid", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ "0xtest": { usd: 100 } }),
      })) as typeof fetch;

      const result = await checkPriceDivergence("0xtest", "base", 110); // Exactly 10%
      expect(result.valid).toBe(true);
      expect(result.divergencePercent).toBe(10);
    });

    it("should handle 10.01% divergence as invalid", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ "0xtest": { usd: 100 } }),
      })) as typeof fetch;

      const result = await checkPriceDivergence("0xtest", "base", 110.01); // Just over 10%
      expect(result.valid).toBe(false);
      expect(result.divergencePercent).toBeGreaterThan(10);
    });
  });

  describe("Agent Rejection Scenarios", () => {
    it("should provide rejection details for malicious price manipulation", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ "0xmanipulated": { usd: 100 } }),
      })) as typeof fetch;

      // Pool price is 50% higher than market - potential manipulation
      const result = await checkPriceDivergence("0xmanipulated", "base", 150);

      expect(result.valid).toBe(false);
      expect(result.warning).toContain("Price Warning");
      expect(result.divergencePercent).toBeCloseTo(50, 0);

      console.log("[Manipulation Test] Warning:", result.warning);
    });

    it("should provide rejection details for stale quote (price dropped)", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ "0xstale": { usd: 100 } }),
      })) as typeof fetch;

      // Pool price is 20% lower - price dropped since quote
      const result = await checkPriceDivergence("0xstale", "base", 80);

      expect(result.valid).toBe(false);
      expect(result.warning).toContain("Price Warning");
      expect(result.divergencePercent).toBeCloseTo(20, 0);

      console.log(
        "[Stale Quote Test] Divergence:",
        result.divergencePercent + "%",
      );
    });
  });
});
