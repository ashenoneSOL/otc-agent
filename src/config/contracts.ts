import localEvm from "./deployments/local-evm.json";
import localSolana from "./deployments/local-solana.json";
import testnetEvm from "./deployments/testnet-evm.json";
import testnetSolana from "./deployments/testnet-solana.json";
import mainnetEvm from "./deployments/mainnet-evm.json";
import mainnetSolana from "./deployments/mainnet-solana.json";
import { getNetwork, type NetworkEnvironment } from "./env";

// =============================================================================
// TYPES
// =============================================================================

export interface EvmChainConfig {
  chainId: number;
  otc: string;
  registrationHelper?: string;
  usdc: string;
  ethUsdFeed?: string;
  bnbUsdFeed?: string;
}

export interface EvmDeployment {
  network: string;
  chainId?: number;
  rpc?: string;
  timestamp?: string;
  deployer?: string;
  contracts: {
    otc?: string;
    usdc?: string;
    // Legacy names from deployment files
    deal?: string;
    usdcToken?: string;
    elizaToken?: string;
    registrationHelper?: string;
    elizaUsdFeed?: string;
    ethUsdFeed?: string;
  };
  accounts?: {
    owner?: string;
    agent?: string;
    approver?: string;
    testWallet?: string;
  };
  testWalletPrivateKey?: string;
  // Multi-chain support
  networks?: {
    base?: EvmChainConfig;
    bsc?: EvmChainConfig;
    ethereum?: EvmChainConfig;
  };
  features?: {
    p2pAutoApproval?: boolean;
    version?: string;
  };
}

export interface SolanaDeployment {
  network: string;
  rpc: string;
  deployer?: string;
  programId: string;
  desk: string;
  deskOwner?: string;
  usdcMint: string;
  registeredTokens?: Record<string, {
    mint: string;
    registry: string;
    treasury: string;
    priceUsd?: number;
  }>;
}

// =============================================================================
// DEPLOYMENT CONFIGS
// =============================================================================

export const CONTRACT_DEPLOYMENTS = {
  local: {
    evm: localEvm as EvmDeployment,
    solana: localSolana as SolanaDeployment,
  },
  testnet: {
    evm: testnetEvm as EvmDeployment,
    solana: testnetSolana as SolanaDeployment,
  },
  mainnet: {
    evm: mainnetEvm as EvmDeployment,
    solana: mainnetSolana as SolanaDeployment,
  },
};

export type NetworkType = NetworkEnvironment;

// Re-export for backwards compatibility
export { getNetwork, getNetwork as getCurrentNetwork };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get deployment configs for a network
 */
export function getContracts(network?: NetworkType) {
  const net = network || getNetwork();
  return CONTRACT_DEPLOYMENTS[net];
}

/**
 * Get EVM contract addresses from deployment config
 * All values come from deployment JSON - no env var overrides
 */
export function getEvmConfig(network?: NetworkType): EvmDeployment {
  const net = network || getNetwork();
  const config = CONTRACT_DEPLOYMENTS[net].evm;
  
  // Handle legacy contract names (deal -> otc, usdcToken -> usdc)
  const otcAddress = config.contracts.otc ?? config.contracts.deal;
  const usdcAddress = config.contracts.usdc ?? config.contracts.usdcToken;
  
  return {
    ...config,
    contracts: {
      ...config.contracts,
      otc: otcAddress,
      usdc: usdcAddress,
    },
  };
}

/**
 * Get Solana config from deployment config
 * All values come from deployment JSON - no env var overrides
 */
export function getSolanaConfig(network?: NetworkType): SolanaDeployment {
  const net = network || getNetwork();
  return CONTRACT_DEPLOYMENTS[net].solana;
}

/**
 * Get OTC contract address for current network
 */
export function getOtcAddress(network?: NetworkType): string {
  const config = getEvmConfig(network);
  const address = config.contracts.otc;
  if (!address) {
    throw new Error(`OTC contract address not configured for network: ${network || getNetwork()}`);
  }
  return address;
}

/**
 * Get Solana desk address for current network
 */
export function getSolanaDesk(network?: NetworkType): string {
  const config = getSolanaConfig(network);
  return config.desk;
}

/**
 * Get Solana program ID for current network
 */
export function getSolanaProgramId(network?: NetworkType): string {
  const config = getSolanaConfig(network);
  return config.programId;
}

/**
 * Get OTC address for a specific EVM chain
 */
export function getOtcAddressForChain(chainId: number, network?: NetworkType): string | undefined {
  const config = getEvmConfig(network);
  
  // Check multi-chain networks first
  if (config.networks) {
    if (chainId === 8453 && config.networks.base) return config.networks.base.otc;
    if (chainId === 56 && config.networks.bsc) return config.networks.bsc.otc;
    if (chainId === 1 && config.networks.ethereum) return config.networks.ethereum.otc;
  }
  
  // Fallback to primary contract
  return config.contracts.otc;
}

/**
 * Get registration helper address for a chain
 */
export function getRegistrationHelperForChain(chainId: number, network?: NetworkType): string | undefined {
  const config = getEvmConfig(network);
  
  if (config.networks) {
    if (chainId === 8453 && config.networks.base) return config.networks.base.registrationHelper;
    if (chainId === 56 && config.networks.bsc) return config.networks.bsc.registrationHelper;
    if (chainId === 1 && config.networks.ethereum) return config.networks.ethereum.registrationHelper;
  }
  
  return config.contracts.registrationHelper;
}

/**
 * Get USDC address for a chain
 */
export function getUsdcAddressForChain(chainId: number, network?: NetworkType): string | undefined {
  const config = getEvmConfig(network);
  
  if (config.networks) {
    if (chainId === 8453 && config.networks.base) return config.networks.base.usdc;
    if (chainId === 56 && config.networks.bsc) return config.networks.bsc.usdc;
    if (chainId === 1 && config.networks.ethereum) return config.networks.ethereum.usdc;
  }
  
  return config.contracts.usdc;
}

/**
 * All mainnet OTC contract addresses (hardcoded for reference)
 * In practice, use getOtcAddressForChain() which reads from deployment JSON
 */
export const MAINNET_OTC_ADDRESSES = {
  base: "0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9",
  bsc: "0x0aD688d08D409852668b6BaF6c07978968070221",
  ethereum: "0x5f36221967E34e3A2d6548aaedF4D1E50FE34D46",
  solana: {
    programId: "q9MhHpeydqTdtPaNpzDoWvP1qY5s3sFHTF1uYcXjdsc",
    desk: "6CBcxFR6dSMJJ7Y4dQZTshJT2KxuwnSXioXEABxNVZPW",
  },
} as const;
