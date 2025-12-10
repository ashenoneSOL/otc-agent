import { createPublicClient, http, type Address, erc20Abi } from "viem";
import { base, baseSepolia, bsc, bscTestnet } from "viem/chains";
import { getCurrentNetwork } from "@/config/contracts";
import { SUPPORTED_CHAINS, type Chain } from "@/config/chains";
import type { Token, TokenWithBalance } from "@/types";

const KNOWN_TOKENS: Record<Chain, Array<{ address: Address; symbol: string; name: string; decimals: number; logoUrl: string }>> = {
  base: [
    {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      logoUrl: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
    },
    {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      logoUrl: "https://assets.coingecko.com/coins/images/2518/small/weth.png",
    },
  ],
  bsc: [
    {
      address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 18,
      logoUrl: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
    },
    {
      address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      symbol: "ETH",
      name: "Binance-Peg Ethereum",
      decimals: 18,
      logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    },
  ],
  jeju: [],
  ethereum: [],
};

function getChainConfig(chain: Chain) {
  const network = getCurrentNetwork();
  const isMainnet = network === "mainnet";

  switch (chain) {
    case "base":
      return isMainnet ? base : baseSepolia;
    case "bsc":
      return isMainnet ? bsc : bscTestnet;
    case "jeju":
      return {
        id: isMainnet ? 420691 : 420690,
        name: isMainnet ? "Jeju" : "Jeju Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: {
            http: [isMainnet ? "https://rpc.jeju.network" : "https://testnet-rpc.jeju.network"],
          },
        },
      };
    default:
      return base;
  }
}

function getPublicClient(chain: Chain) {
  const chainConfig = getChainConfig(chain);
  const config = SUPPORTED_CHAINS[chain];
  return createPublicClient({
    chain: chainConfig,
    transport: http(config.rpcUrl),
  });
}

export async function getTokenBalance(
  chain: Chain,
  tokenAddress: Address,
  walletAddress: Address,
): Promise<bigint> {
  const client = getPublicClient(chain);
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress],
  });
}

export async function getTokenInfo(
  chain: Chain,
  tokenAddress: Address,
): Promise<{ symbol: string; name: string; decimals: number }> {
  const client = getPublicClient(chain);

  const [symbol, name, decimals] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "name",
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  return { symbol, name, decimals };
}

export async function scanWalletTokens(
  walletAddress: Address,
  chains: Chain[] = ["base", "bsc", "jeju"],
): Promise<TokenWithBalance[]> {
  const results: TokenWithBalance[] = [];

  for (const chain of chains) {
    const knownTokens = KNOWN_TOKENS[chain] || [];

    for (const tokenInfo of knownTokens) {
      try {
        const balance = await getTokenBalance(chain, tokenInfo.address, walletAddress);
        if (balance > 0n) {
          const balanceFormatted = (Number(balance) / Math.pow(10, tokenInfo.decimals)).toFixed(6);
          results.push({
            id: `token-${chain}-${tokenInfo.address.toLowerCase()}`,
            symbol: tokenInfo.symbol,
            name: tokenInfo.name,
            contractAddress: tokenInfo.address,
            chain,
            decimals: tokenInfo.decimals,
            logoUrl: tokenInfo.logoUrl,
            description: "",
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            balance: balance.toString(),
            balanceFormatted,
            balanceUsd: 0,
            priceUsd: 0,
          });
        }
      } catch {
        // Token may not exist or be accessible on this chain
      }
    }
  }

  return results;
}

export async function getMultiChainTokenBalances(
  tokenAddress: Address,
  walletAddress: Address,
  chains: Chain[] = ["base", "bsc", "jeju"],
): Promise<Record<Chain, bigint>> {
  const balances: Record<string, bigint> = {};

  await Promise.all(
    chains.map(async (chain) => {
      try {
        const balance = await getTokenBalance(chain, tokenAddress, walletAddress);
        balances[chain] = balance;
      } catch {
        balances[chain] = 0n;
      }
    }),
  );

  return balances as Record<Chain, bigint>;
}

export async function findTokenOnAllChains(
  tokenSymbol: string,
): Promise<Array<{ chain: Chain; address: Address; decimals: number }>> {
  const results: Array<{ chain: Chain; address: Address; decimals: number }> = [];

  for (const [chain, tokens] of Object.entries(KNOWN_TOKENS)) {
    const token = tokens.find((t) => t.symbol.toLowerCase() === tokenSymbol.toLowerCase());
    if (token) {
      results.push({
        chain: chain as Chain,
        address: token.address,
        decimals: token.decimals,
      });
    }
  }

  return results;
}

export function getKnownTokens(chain: Chain): typeof KNOWN_TOKENS.base {
  return KNOWN_TOKENS[chain] || [];
}

export function getAllSupportedChains(): Chain[] {
  return Object.keys(SUPPORTED_CHAINS) as Chain[];
}


