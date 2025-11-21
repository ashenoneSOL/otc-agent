import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: bigint;
  tvlUsd: number;
  baseToken: "USDC" | "WETH";
}

const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
]);

const poolAbi = parseAbi([
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function liquidity() external view returns (uint128)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

/**
 * Find all Uniswap V3 pools for a given token
 * @param tokenAddress The token to find pools for
 * @returns Array of pool information sorted by TVL
 */
export async function findUniswapV3Pools(
  tokenAddress: string,
): Promise<PoolInfo[]> {
  const rpcUrl =
    process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const pools: PoolInfo[] = [];

  // Check pools against USDC
  for (const fee of FEE_TIERS) {
    try {
      const poolAddress = await client.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [
          tokenAddress as `0x${string}`,
          USDC_ADDRESS as `0x${string}`,
          fee,
        ],
        authorizationList: [],
      });

      if (
        poolAddress &&
        poolAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        const poolInfo = await getPoolInfo(client, poolAddress, "USDC");
        if (poolInfo) {
          pools.push(poolInfo);
        }
      }
    } catch (error) {
      console.warn(`Failed to check USDC pool for fee ${fee}:`, error);
    }
  }

  // Check pools against WETH
  for (const fee of FEE_TIERS) {
    try {
      const poolAddress = await client.readContract({
        address: UNISWAP_V3_FACTORY,
        abi: factoryAbi,
        functionName: "getPool",
        args: [
          tokenAddress as `0x${string}`,
          WETH_ADDRESS as `0x${string}`,
          fee,
        ],
        authorizationList: [],
      });

      if (
        poolAddress &&
        poolAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        const poolInfo = await getPoolInfo(client, poolAddress, "WETH");
        if (poolInfo) {
          pools.push(poolInfo);
        }
      }
    } catch (error) {
      console.warn(`Failed to check WETH pool for fee ${fee}:`, error);
    }
  }

  // Sort by TVL descending
  pools.sort((a, b) => b.tvlUsd - a.tvlUsd);

  return pools;
}

/**
 * Get detailed information about a pool
 */
async function getPoolInfo(
  client: any,
  poolAddress: string,
  baseToken: "USDC" | "WETH",
): Promise<PoolInfo | null> {
  try {
    const [token0, token1, liquidity, slot0Data] = await Promise.all([
      client.readContract({
        address: poolAddress as `0x${string}`,
        abi: poolAbi,
        functionName: "token0",
        authorizationList: [],
      }),
      client.readContract({
        address: poolAddress as `0x${string}`,
        abi: poolAbi,
        functionName: "token1",
        authorizationList: [],
      }),
      client.readContract({
        address: poolAddress as `0x${string}`,
        abi: poolAbi,
        functionName: "liquidity",
        authorizationList: [],
      }),
      client.readContract({
        address: poolAddress as `0x${string}`,
        abi: poolAbi,
        functionName: "slot0",
        authorizationList: [],
      }),
    ]);

    // Extract fee from pool address (last 3 bytes typically encode fee tier info)
    // For simplicity, we can infer from the factory call that created it
    const fee = FEE_TIERS[0]; // This should be passed in or extracted properly

    // Calculate rough TVL estimate
    const tvlUsd = estimateTVL(liquidity, baseToken);

    return {
      address: poolAddress,
      token0: token0 as string,
      token1: token1 as string,
      fee,
      liquidity: BigInt(liquidity.toString()),
      tvlUsd,
      baseToken,
    };
  } catch (error) {
    console.error(`Failed to get pool info for ${poolAddress}:`, error);
    return null;
  }
}

/**
 * Estimate TVL in USD based on liquidity
 * This is a rough estimate - actual TVL requires price data
 */
function estimateTVL(liquidity: bigint, baseToken: "USDC" | "WETH"): number {
  // Very rough estimate
  // For USDC: 1 unit of liquidity ≈ $1-10 TVL
  // For WETH: 1 unit of liquidity ≈ $0.001-0.01 TVL (assuming ETH at $3000)

  const liquidityNum = Number(liquidity);

  if (baseToken === "USDC") {
    return liquidityNum * 2; // Rough multiplier
  } else {
    return liquidityNum * 0.005 * 3000; // Rough ETH price
  }
}

/**
 * Find the best pool for a token (highest TVL)
 */
export async function findBestPool(
  tokenAddress: string,
): Promise<PoolInfo | null> {
  const pools = await findUniswapV3Pools(tokenAddress);

  if (pools.length === 0) {
    return null;
  }

  // Return pool with highest TVL
  return pools[0];
}

/**
 * Validate pool has sufficient liquidity
 */
export function validatePoolLiquidity(pool: PoolInfo): {
  valid: boolean;
  warning?: string;
} {
  const MIN_LIQUIDITY_USD = 50000; // $50k minimum

  if (pool.tvlUsd < MIN_LIQUIDITY_USD) {
    return {
      valid: false,
      warning: `Low liquidity: $${pool.tvlUsd.toLocaleString()}. Minimum recommended: $${MIN_LIQUIDITY_USD.toLocaleString()}`,
    };
  }

  return { valid: true };
}

/**
 * Format pool info for display
 */
export function formatPoolInfo(pool: PoolInfo): string {
  const feePercent = (pool.fee / 10000).toFixed(2);
  return `${pool.baseToken} Pool (${feePercent}% fee) - TVL: $${pool.tvlUsd.toLocaleString()}`;
}
