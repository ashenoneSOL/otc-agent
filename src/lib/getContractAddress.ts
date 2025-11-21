import type { Address } from "viem";

/**
 * Get the appropriate OTC contract address based on network configuration
 * Uses the same logic as getChain() to determine which network is active
 *
 * @returns The OTC contract address for the current network
 * @throws Error if no contract address is configured for the selected network
 */
export function getContractAddress(): Address {
  const env = process.env.NODE_ENV;
  const network = process.env.NETWORK || "localhost";

  // Production: Use mainnet addresses
  if (env === "production") {
    if (network === "base") {
      const address = process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS;
      if (!address) {
        throw new Error(
          `NEXT_PUBLIC_BASE_OTC_ADDRESS is required when NETWORK=base in production`,
        );
      }
      return address as Address;
    }
    if (network === "bsc") {
      const address = process.env.NEXT_PUBLIC_BSC_OTC_ADDRESS;
      if (!address) {
        throw new Error(
          `NEXT_PUBLIC_BSC_OTC_ADDRESS is required when NETWORK=bsc in production`,
        );
      }
      return address as Address;
    }
    // Default to Base mainnet in production
    const address = process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS;
    if (!address) {
      throw new Error(
        `NEXT_PUBLIC_BASE_OTC_ADDRESS is required for Base mainnet in production`,
      );
    }
    return address as Address;
  }

  // Development/staging: Support multiple networks
  switch (network) {
    case "base":
      return (process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS ||
        process.env.NEXT_PUBLIC_OTC_ADDRESS) as Address;
    case "base-sepolia":
      return (process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS ||
        process.env.NEXT_PUBLIC_OTC_ADDRESS) as Address;
    case "bsc":
      return (process.env.NEXT_PUBLIC_BSC_OTC_ADDRESS ||
        process.env.NEXT_PUBLIC_OTC_ADDRESS) as Address;
    case "bsc-testnet":
      return (process.env.NEXT_PUBLIC_BSC_OTC_ADDRESS ||
        process.env.NEXT_PUBLIC_OTC_ADDRESS) as Address;
    case "localhost":
    case "anvil":
    case "localnet":
      return (process.env.NEXT_PUBLIC_OTC_ADDRESS ||
        "0x0000000000000000000000000000000000000000") as Address;
    default:
      // Default to localhost/anvil in development
      return (process.env.NEXT_PUBLIC_OTC_ADDRESS ||
        "0x0000000000000000000000000000000000000000") as Address;
  }
}
