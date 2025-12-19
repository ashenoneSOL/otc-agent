import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  localhost,
  type Chain as ViemChain,
} from "viem/chains";
import { getContracts, getNetwork } from "./contracts";
import { LOCAL_DEFAULTS, getSolanaRpcProxyUrl } from "./env";

// String-based chain identifier for database/API (lowercase, URL-safe)
export type Chain = "ethereum" | "base" | "bsc" | "solana";
export type ChainFamily = "evm" | "solana";

export interface ChainConfig {
  id: string; // String ID for database storage
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts: {
    otc?: string;
    usdc?: string;
    registrationHelper?: string;
  };
  type: ChainFamily;
  viemChain?: ViemChain; // Reference to viem chain for wagmi (EVM only)
  chainId?: number; // Numeric chain ID (EVM only)
}

// Use centralized network resolution from contracts.ts
const env = getNetwork();
const deployments = getContracts(env);

export const SUPPORTED_CHAINS: Record<Chain, ChainConfig> = {
  ethereum: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";
    
    // Local dev uses localhost/Anvil, testnet uses Sepolia, mainnet uses Ethereum mainnet
    const chain = isLocal ? localhost : isMainnet ? mainnet : sepolia;
    
    // Get addresses from deployment config
    const networkConfig = deployments.evm?.networks?.ethereum;
    
    // RPC URL: local uses Anvil, mainnet/testnet use proxy to keep API key server-side
    const rpcUrl = isLocal ? LOCAL_DEFAULTS.evmRpc : "/api/rpc/ethereum";

    return {
      id: chain.id.toString(),
      name: isLocal ? "Anvil Local" : isMainnet ? "Ethereum" : "Sepolia",
      rpcUrl,
      explorerUrl: isLocal
        ? "http://localhost:8545"
        : isMainnet
          ? "https://etherscan.io"
          : "https://sepolia.etherscan.io",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      contracts: {
        otc: networkConfig?.otc || deployments.evm?.contracts?.otc,
        usdc: networkConfig?.usdc || (isMainnet 
          ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  // USDC on Ethereum mainnet
          : isLocal 
            ? deployments.evm?.contracts?.usdc
            : "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"), // USDC on Sepolia
        registrationHelper: networkConfig?.registrationHelper || deployments.evm?.contracts?.registrationHelper,
      },
      type: "evm" as ChainFamily,
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
  base: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";
    const chain = isLocal ? localhost : isMainnet ? base : baseSepolia;
    
    // Get addresses from deployment config
    const networkConfig = deployments.evm?.networks?.base;
    
    // Use proxy route to keep Alchemy key server-side
    const rpcUrl = isLocal ? LOCAL_DEFAULTS.evmRpc : "/api/rpc/base";

    return {
      id: chain.id.toString(),
      name: isLocal ? "Anvil Local" : isMainnet ? "Base" : "Base Sepolia",
      rpcUrl,
      explorerUrl: isLocal
        ? "http://localhost:8545"
        : isMainnet
          ? "https://basescan.org"
          : "https://sepolia.basescan.org",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      contracts: {
        otc: networkConfig?.otc || deployments.evm?.contracts?.otc,
        usdc: networkConfig?.usdc || (isMainnet
          ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
          : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
        registrationHelper: networkConfig?.registrationHelper || deployments.evm?.contracts?.registrationHelper,
      },
      type: "evm" as ChainFamily,
      viemChain: chain,
      chainId: isLocal ? 31337 : chain.id,
    };
  })(),
  bsc: (() => {
    const isMainnet = env === "mainnet";
    const chain = isMainnet ? bsc : bscTestnet;
    
    // Get addresses from deployment config
    const networkConfig = deployments.evm?.networks?.bsc;

    return {
      id: chain.id.toString(),
      name: isMainnet ? "BSC" : "BSC Testnet",
      rpcUrl: isMainnet
        ? "https://bsc-dataseed1.binance.org"
        : "https://data-seed-prebsc-1-s1.binance.org:8545",
      explorerUrl: isMainnet
        ? "https://bscscan.com"
        : "https://testnet.bscscan.com",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      contracts: {
        otc: networkConfig?.otc,
        usdc: networkConfig?.usdc || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        registrationHelper: networkConfig?.registrationHelper,
      },
      type: "evm" as ChainFamily,
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
  solana: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";

    // Client-side: always proxy through backend for mainnet
    // Local uses direct localhost URL
    const rpcUrl = isLocal
      ? LOCAL_DEFAULTS.solanaRpc
      : isMainnet
        ? getSolanaRpcProxyUrl()  // Proxy to /api/rpc/solana -> Helius
        : "https://api.devnet.solana.com";

    return {
      id: isMainnet
        ? "solana-mainnet"
        : isLocal
          ? "solana-localnet"
          : "solana-devnet",
      name: isMainnet
        ? "Solana"
        : isLocal
          ? "Solana Localnet"
          : "Solana Devnet",
      rpcUrl,
      explorerUrl: "https://explorer.solana.com",
      nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
      contracts: {
        otc: deployments.solana?.desk,
        usdc: deployments.solana?.usdcMint || (isMainnet
          ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
          : "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"), // Devnet USDC
      },
      type: "solana" as ChainFamily,
    };
  })(),
};

/**
 * Get chain config by identifier
 */
export function getChainConfig(chain: Chain): ChainConfig {
  return SUPPORTED_CHAINS[chain];
}

/**
 * Check if chain is EVM-based
 */
export function isEVMChain(chain: Chain): boolean {
  return SUPPORTED_CHAINS[chain].type === "evm";
}

/**
 * Check if chain is Solana-based
 */
export function isSolanaChain(chain: Chain): boolean {
  return SUPPORTED_CHAINS[chain].type === "solana";
}

/**
 * Get chain identifier from string chain ID (database format)
 */
export function getChainFromId(chainId: string): Chain | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.id === chainId) return key as Chain;
  }
  return null;
}

/**
 * Get chain identifier from numeric chain ID (wagmi/viem format)
 */
export function getChainFromNumericId(chainId: number): Chain | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.chainId === chainId) return key as Chain;
  }
  return null;
}

/**
 * Get all viem chains for wagmi configuration
 */
export function getAllViemChains(): ViemChain[] {
  return Object.values(SUPPORTED_CHAINS)
    .filter((config) => config.viemChain)
    .map((config) => config.viemChain!);
}
