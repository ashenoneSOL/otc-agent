import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  localhost,
  type Chain,
} from "viem/chains";
import { getNetwork, getEvmConfig } from "@/config/contracts";
import { LOCAL_DEFAULTS } from "@/config/env";

// Anvil chain with correct chain ID (31337)
const anvil: Chain = {
  ...localhost,
  id: 31337,
  name: "Anvil",
};

/**
 * Get the appropriate chain based on environment and configuration
 * Supports: Base, BSC, Anvil/localhost
 */
export function getChain(): Chain {
  const network = getNetwork();

  // Handle unified network names
  if (network === "mainnet") return base;
  if (network === "testnet") return baseSepolia;
  if (network === "local") return anvil;

  // Default to Base mainnet
  return base;
}

/**
 * Get RPC URL for the current chain
 * Uses deployment config
 */
export function getRpcUrl(): string {
  const config = getEvmConfig();
  return config.rpc || LOCAL_DEFAULTS.evmRpc;
}

/**
 * Get RPC URL for a specific chain type
 * Uses proxy routes for mainnet to keep API keys server-side
 * @param chainType - Chain identifier (ethereum, base, bsc, localhost, etc.)
 */
export function getRpcUrlForChain(chainType: string): string {
  switch (chainType) {
    case "ethereum":
    case "sepolia":
      return "/api/rpc/ethereum";
    case "base":
    case "base-sepolia":
      return "/api/rpc/base";
    case "bsc":
    case "bsc-testnet":
      return "https://bsc-dataseed1.binance.org";
    case "localhost":
    case "anvil":
      return LOCAL_DEFAULTS.evmRpc;
    default:
      return getRpcUrl();
  }
}

/**
 * Get viem chain config for a chain type
 * @param chainType - Chain identifier (ethereum, base, bsc, etc.)
 */
export function getViemChainForType(chainType: string): Chain {
  switch (chainType) {
    case "ethereum":
      return mainnet;
    case "sepolia":
      return sepolia;
    case "base":
      return base;
    case "base-sepolia":
      return baseSepolia;
    case "bsc":
      return bsc;
    case "bsc-testnet":
      return bscTestnet;
    case "localhost":
    case "anvil":
      return localhost;
    default:
      return base;
  }
}
