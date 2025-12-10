import localEvm from "./deployments/local-evm.json";
import testnetEvm from "./deployments/testnet-evm.json";
import mainnetEvm from "./deployments/mainnet-evm.json";

export interface EvmNetworkContracts {
  otc: string;
  usdc: string;
  elizaToken?: string;
  registrationHelper?: string;
  elizaUsdFeed?: string;
  ethUsdFeed?: string;
}

export interface AdditionalNetwork {
  chainId: number;
  rpc: string;
  contracts: Partial<EvmNetworkContracts>;
}

export interface EvmDeployment {
  network: string;
  chainId: number;
  rpc: string;
  deployer?: string;
  contracts: EvmNetworkContracts;
  accounts?: {
    owner?: string;
    agent?: string;
    approver?: string;
    testWallet?: string;
  };
  additionalNetworks?: {
    bscTestnet?: AdditionalNetwork;
    bscMainnet?: AdditionalNetwork;
    jejuDevnet?: AdditionalNetwork;
    jejuTestnet?: AdditionalNetwork;
    jejuMainnet?: AdditionalNetwork;
  };
}

export const CONTRACT_DEPLOYMENTS = {
  local: {
    evm: localEvm as EvmDeployment,
  },
  testnet: {
    evm: testnetEvm as EvmDeployment,
  },
  mainnet: {
    evm: mainnetEvm as EvmDeployment,
  },
};

export type NetworkType = "local" | "testnet" | "mainnet";

export function getCurrentNetwork(): NetworkType {
  const explicitNetwork = process.env.NEXT_PUBLIC_NETWORK || process.env.NETWORK;

  if (explicitNetwork === "mainnet") return "mainnet";
  if (explicitNetwork === "testnet" || explicitNetwork === "sepolia") return "testnet";
  if (explicitNetwork === "local" || explicitNetwork === "localnet" || explicitNetwork === "anvil") return "local";

  if (process.env.NEXT_PUBLIC_USE_MAINNET === "true") return "mainnet";

  return "mainnet";
}

export function getContracts(network?: NetworkType) {
  const net = network || getCurrentNetwork();
  return CONTRACT_DEPLOYMENTS[net];
}

export function getEvmConfig(network?: NetworkType): EvmDeployment {
  const net = network || getCurrentNetwork();
  const config = CONTRACT_DEPLOYMENTS[net].evm;

  return {
    ...config,
    rpc: process.env.NEXT_PUBLIC_RPC_URL || config.rpc,
    contracts: {
      ...config.contracts,
      otc: process.env.NEXT_PUBLIC_OTC_ADDRESS ||
           (net === "mainnet" ? process.env.NEXT_PUBLIC_OTC_ADDRESS_MAINNET : null) ||
           config.contracts.otc,
      usdc: process.env.NEXT_PUBLIC_USDC_ADDRESS || config.contracts.usdc,
    },
    accounts: {
      ...config.accounts,
      approver: process.env.APPROVER_ADDRESS || config.accounts?.approver,
    },
  };
}

export function getOtcAddress(network?: NetworkType): string {
  const config = getEvmConfig(network);
  return config.contracts.otc;
}

export function getBscConfig(network?: NetworkType): AdditionalNetwork | null {
  const net = network || getCurrentNetwork();
  const config = CONTRACT_DEPLOYMENTS[net].evm;

  const networkKey = net === "mainnet" ? "bscMainnet" : "bscTestnet";
  const bscConfig = config.additionalNetworks?.[networkKey];

  if (!bscConfig) return null;

  return {
    ...bscConfig,
    rpc: process.env.NEXT_PUBLIC_BSC_RPC_URL || bscConfig.rpc,
    contracts: {
      ...bscConfig.contracts,
      otc: process.env.NEXT_PUBLIC_BSC_OTC_ADDRESS || bscConfig.contracts.otc || "",
    },
  };
}

export function getJejuConfig(network?: NetworkType): AdditionalNetwork | null {
  const net = network || getCurrentNetwork();
  const config = CONTRACT_DEPLOYMENTS[net].evm;

  const isLocal = net === "local";
  const networkKey = net === "mainnet" ? "jejuMainnet" : isLocal ? "jejuDevnet" : "jejuTestnet";
  const jejuConfig = config.additionalNetworks?.[networkKey];

  if (!jejuConfig) return null;

  return {
    ...jejuConfig,
    rpc: process.env.NEXT_PUBLIC_JEJU_RPC_URL || jejuConfig.rpc,
    contracts: {
      ...jejuConfig.contracts,
      otc: process.env.NEXT_PUBLIC_JEJU_OTC_ADDRESS || jejuConfig.contracts.otc || "",
    },
  };
}

export function getOtcAddressForChain(
  chainType: "base" | "bsc" | "jeju",
  network?: NetworkType
): string {
  const net = network || getCurrentNetwork();

  switch (chainType) {
    case "base":
      return getEvmConfig(net).contracts.otc;
    case "bsc":
      return getBscConfig(net)?.contracts.otc || "";
    case "jeju":
      return getJejuConfig(net)?.contracts.otc || "";
  }
}
