import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  localhost,
  type Chain as ViemChain,
} from "viem/chains";
import { getContracts, getCurrentNetwork } from "./contracts";

const jejuDevnet: ViemChain = {
  id: 420689,
  name: "Jeju Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://devnet-rpc.jeju.network"] },
  },
  blockExplorers: {
    default: { name: "Jeju Explorer", url: "https://devnet-explorer.jeju.network" },
  },
};

const jejuTestnet: ViemChain = {
  id: 420690,
  name: "Jeju Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.jeju.network"] },
  },
  blockExplorers: {
    default: { name: "Jeju Explorer", url: "https://testnet-explorer.jeju.network" },
  },
};

const jejuMainnet: ViemChain = {
  id: 420691,
  name: "Jeju",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.jeju.network"] },
  },
  blockExplorers: {
    default: { name: "Jeju Explorer", url: "https://explorer.jeju.network" },
  },
};

export type Chain = "ethereum" | "base" | "bsc" | "jeju";

export interface ChainConfig {
  id: string;
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
  };
  viemChain: ViemChain;
  chainId: number;
}

const env = getCurrentNetwork();
const deployments = getContracts(env);

export const SUPPORTED_CHAINS: Record<Chain, ChainConfig> = {
  ethereum: {
    id: localhost.id.toString(),
    name: "Anvil Local",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545",
    explorerUrl: "http://localhost:8545",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    contracts: {
      otc:
        deployments.evm?.contracts?.otc || process.env.NEXT_PUBLIC_OTC_ADDRESS,
      usdc:
        deployments.evm?.contracts?.usdc ||
        process.env.NEXT_PUBLIC_USDC_ADDRESS,
    },
    viemChain: localhost,
    chainId: localhost.id,
  },
  base: (() => {
    const isMainnet = env === "mainnet";
    const chain = isMainnet ? base : baseSepolia;

    const MAINNET_OTC = "0x12FA61c9d77AEd9BeDA0FF4bF2E900F31bdBdc45";
    const TESTNET_OTC = "0x08cAa161780d195E0799b73b318da5D175b85313";

    const otc =
      deployments.evm?.contracts?.otc ||
      process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS ||
      (isMainnet ? MAINNET_OTC : TESTNET_OTC);

    const rpcUrl =
      process.env.NEXT_PUBLIC_BASE_RPC_URL ||
      (isMainnet ? "/api/rpc/base" : "https://sepolia.base.org");

    return {
      id: chain.id.toString(),
      name: isMainnet ? "Base" : "Base Sepolia",
      rpcUrl,
      explorerUrl: isMainnet
        ? "https://basescan.org"
        : "https://sepolia.basescan.org",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      contracts: {
        otc: otc,
        usdc: isMainnet
          ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
          : "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
  bsc: (() => {
    const isMainnet = env === "mainnet";
    const chain = isMainnet ? bsc : bscTestnet;
    const otc =
      deployments.evm?.contracts?.otc ||
      process.env.NEXT_PUBLIC_BSC_OTC_ADDRESS;

    return {
      id: chain.id.toString(),
      name: isMainnet ? "BSC" : "BSC Testnet",
      rpcUrl:
        process.env.NEXT_PUBLIC_BSC_RPC_URL ||
        (isMainnet
          ? "https://bsc-dataseed1.binance.org"
          : "https://data-seed-prebsc-1-s1.binance.org:8545"),
      explorerUrl: isMainnet
        ? "https://bscscan.com"
        : "https://testnet.bscscan.com",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      contracts: {
        otc: otc,
        usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      },
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
  jeju: (() => {
    const isMainnet = env === "mainnet";
    const isLocal = env === "local";

    const chain = isMainnet ? jejuMainnet : isLocal ? jejuDevnet : jejuTestnet;

    const otc =
      process.env.NEXT_PUBLIC_JEJU_OTC_ADDRESS ||
      deployments.evm?.contracts?.otc;

    return {
      id: chain.id.toString(),
      name: chain.name,
      rpcUrl:
        process.env.NEXT_PUBLIC_JEJU_RPC_URL ||
        (isMainnet
          ? "https://rpc.jeju.network"
          : isLocal
            ? "https://devnet-rpc.jeju.network"
            : "https://testnet-rpc.jeju.network"),
      explorerUrl: isMainnet
        ? "https://explorer.jeju.network"
        : isLocal
          ? "https://devnet-explorer.jeju.network"
          : "https://testnet-explorer.jeju.network",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      contracts: {
        otc: otc,
        usdc: process.env.NEXT_PUBLIC_JEJU_USDC_ADDRESS,
      },
      viemChain: chain,
      chainId: chain.id,
    };
  })(),
};

export function getChainConfig(chain: Chain): ChainConfig {
  return SUPPORTED_CHAINS[chain];
}

export function getChainFromId(chainId: string): Chain | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.id === chainId) return key as Chain;
  }
  return null;
}

export function getChainFromNumericId(chainId: number): Chain | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.chainId === chainId) return key as Chain;
  }
  return null;
}

export function getAllViemChains(): ViemChain[] {
  return Object.values(SUPPORTED_CHAINS).map((config) => config.viemChain);
}
