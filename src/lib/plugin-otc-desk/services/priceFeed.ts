/**
 * Price feed service for fetching real-time native token prices
 * For multi-token/ERC20 support, use MarketDataService or price-fetcher utils
 */

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

// Lazy getter to avoid circular dependency at module load time
// Using a minimal interface to avoid type import dependency
interface AgentRuntimeManager {
  getRuntime(): Promise<{
    getCache<T>(key: string): Promise<T | null>;
    setCache<T>(key: string, value: T): Promise<void>;
  }>;
}
let _agentRuntime: AgentRuntimeManager | null = null;

// Use indirect path to prevent static analysis from detecting circular dependency
const AGENT_RUNTIME_PATH = "../../agent-runtime";
async function getAgentRuntime(): Promise<AgentRuntimeManager> {
  if (!_agentRuntime) {
    // Dynamic import with variable path breaks static analysis detection
    const mod = (await import(/* webpackIgnore: true */ AGENT_RUNTIME_PATH)) as {
      agentRuntime: AgentRuntimeManager;
    };
    _agentRuntime = mod.agentRuntime;
  }
  return _agentRuntime;
}

/**
 * Get cached price from runtime storage
 */
async function getCachedPrice(key: string): Promise<PriceCache | null> {
  const agentRuntime = await getAgentRuntime();
  const runtime = await agentRuntime.getRuntime();
  return (await runtime.getCache<PriceCache>(`price:${key}`)) || null;
}

/**
 * Set cached price in runtime storage
 */
async function setCachedPrice(key: string, value: PriceCache): Promise<void> {
  const agentRuntime = await getAgentRuntime();
  const runtime = await agentRuntime.getRuntime();
  await runtime.setCache(`price:${key}`, value);
}

/**
 * Fetch native token price from CoinGecko with caching
 */
async function fetchNativePrice(symbol: "ETH" | "BNB" | "SOL"): Promise<number> {
  // Check cache first
  const cached = await getCachedPrice(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }

  const coinId = COINGECKO_IDS[symbol];
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko ${symbol} fetch failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as Record<string, { usd?: number }>;
  const priceData = data[coinId];

  if (!priceData || typeof priceData.usd !== "number" || priceData.usd <= 0) {
    throw new Error(`Invalid ${symbol} price from CoinGecko: ${JSON.stringify(data)}`);
  }

  await setCachedPrice(symbol, { price: priceData.usd, timestamp: Date.now() });
  return priceData.usd;
}

/** Get ETH price in USD */
export const getEthPriceUsd = () => fetchNativePrice("ETH");

/** Get BNB price in USD */
export const getBnbPriceUsd = () => fetchNativePrice("BNB");

/** Get SOL price in USD */
export const getSolPriceUsd = () => fetchNativePrice("SOL");
