/**
 * Price feed service for fetching real-time native token prices
 * For multi-token/ERC20 support, use MarketDataService or price-fetcher utils
 */

import { agentRuntime } from "../../agent-runtime";

interface PriceCache {
  price: number;
  timestamp: number;
}

const CACHE_TTL = 60_000; // 60 seconds

/** CoinGecko IDs for native tokens */
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
};

/**
 * Fallback prices - used only when API fails AND no cache exists
 * These are approximate values and will be overwritten by real prices
 * Updated periodically to stay reasonable
 */
const FALLBACK_PRICES: Record<string, number> = {
  ETH: 3500,
  BNB: 700,
  SOL: 140,
};

/**
 * Get cached price from runtime storage
 */
async function getCachedPrice(key: string): Promise<PriceCache | null> {
  const runtime = await agentRuntime.getRuntime();
  return (await runtime.getCache<PriceCache>(`price:${key}`)) || null;
}

/**
 * Set cached price in runtime storage
 */
async function setCachedPrice(key: string, value: PriceCache): Promise<void> {
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`price:${key}`, value);
}

/**
 * Fetch native token price from CoinGecko with caching and fallback
 */
async function fetchNativePrice(symbol: "ETH" | "BNB" | "SOL"): Promise<number> {
  // Check cache first
  const cached = await getCachedPrice(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  try {
    const coinId = COINGECKO_IDS[symbol];
    const apiKey = process.env.COINGECKO_API_KEY;

    // Use Pro API if key available (higher rate limits)
    const url = apiKey
      ? `https://pro-api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      : `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;

    const headers: HeadersInit = { Accept: "application/json" };
    if (apiKey) {
      headers["x-cg-pro-api-key"] = apiKey;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // On rate limit (429) or other errors, use stale cache if available
      if (cached) {
        console.warn(
          `[PriceFeed] CoinGecko ${symbol} failed (HTTP ${response.status}), using stale cache from ${new Date(cached.timestamp).toISOString()}`,
        );
        return cached.price;
      }
      throw new Error(`CoinGecko ${symbol} fetch failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, { usd?: number }>;
    const priceData = data[coinId];

    if (!priceData || typeof priceData.usd !== "number" || priceData.usd <= 0) {
      if (cached) {
        console.warn(`[PriceFeed] Invalid ${symbol} price, using stale cache`);
        return cached.price;
      }
      throw new Error(`Invalid ${symbol} price from CoinGecko: ${JSON.stringify(data)}`);
    }

    await setCachedPrice(symbol, { price: priceData.usd, timestamp: Date.now() });
    return priceData.usd;
  } catch (error) {
    // On any fetch error (network, timeout, etc.), use stale cache if available
    if (cached) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[PriceFeed] ${symbol} fetch error (${errorMsg}), using stale cache`);
      return cached.price;
    }

    // Last resort: use hardcoded fallback price
    const fallbackPrice = FALLBACK_PRICES[symbol];
    if (fallbackPrice) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[PriceFeed] ${symbol} fetch failed (${errorMsg}), using fallback price: $${fallbackPrice}`,
      );
      // Cache the fallback so we don't spam requests
      await setCachedPrice(symbol, { price: fallbackPrice, timestamp: Date.now() });
      return fallbackPrice;
    }

    throw error;
  }
}

/** Get ETH price in USD */
export const getEthPriceUsd = () => fetchNativePrice("ETH");

/** Get BNB price in USD */
export const getBnbPriceUsd = () => fetchNativePrice("BNB");

/** Get SOL price in USD */
export const getSolPriceUsd = () => fetchNativePrice("SOL");
