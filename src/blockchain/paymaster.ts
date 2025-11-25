/**
 * Multicoin Paymaster Integration for TheDesk
 * Supports gas payments in elizaOS, CLANKER, VIRTUAL, CLANKERMON and other ERC-20 tokens
 */

import {
  type Address,
  type PublicClient,
  createPublicClient,
  http,
  parseAbi,
  encodePacked,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { safeReadContract } from "@/lib/viem-utils";
import type { Abi } from "viem";

// Paymaster Factory ABI
const PAYMASTER_FACTORY_ABI = parseAbi([
  "function getAllPaymasters() external view returns (address[] memory)",
  "function getPaymasterByToken(address token) external view returns (address)",
  "function paymasterStake(address paymaster) external view returns (uint256)",
]);

// Paymaster ABI
const PAYMASTER_ABI = parseAbi([
  "function token() external view returns (address)",
  "function getQuote(uint256 ethAmount) external view returns (uint256)",
]);

// Contract addresses
const PAYMASTER_FACTORY_ADDRESS = (process.env
  .NEXT_PUBLIC_PAYMASTER_FACTORY_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

// Minimum ETH stake threshold for paymasters (10 ETH)
const MIN_STAKE_THRESHOLD = BigInt(10) * BigInt(10 ** 18);

export interface PaymasterInfo {
  address: Address;
  token: Address;
  stake: bigint;
  available: boolean;
}

export interface PaymasterQuote {
  paymaster: Address;
  token: Address;
  ethAmount: bigint;
  tokenAmount: bigint;
}

/**
 * Get public client for blockchain interactions
 */
function getPublicClient(): PublicClient {
  const network = process.env.NEXT_PUBLIC_NETWORK || "base-sepolia";
  const chain = network === "base" ? base : baseSepolia;

  // Use unknown cast to avoid deep type instantiation
  return createPublicClient({
    chain,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL),
  }) as unknown as PublicClient;
}

/**
 * Get all available paymasters with sufficient stake
 */
export async function getAvailablePaymasters(
  minStake: bigint = MIN_STAKE_THRESHOLD,
): Promise<PaymasterInfo[]> {
  if (
    PAYMASTER_FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000"
  ) {
    console.warn("[Paymaster] Factory not configured, returning empty list");
    return [];
  }

  try {
    const client = getPublicClient();

    // Get all paymasters from factory
    const paymasters = await safeReadContract<Address[]>(client, {
      address: PAYMASTER_FACTORY_ADDRESS,
      abi: PAYMASTER_FACTORY_ABI as Abi,
      functionName: "getAllPaymasters",
    });

    // Get details for each paymaster
    const paymasterDetails = await Promise.all(
      paymasters.map(async (paymasterAddr) => {
        try {
          const [token, stake] = await Promise.all([
            safeReadContract<Address>(client, {
              address: paymasterAddr,
              abi: PAYMASTER_ABI as Abi,
              functionName: "token",
            }),
            safeReadContract<bigint>(client, {
              address: PAYMASTER_FACTORY_ADDRESS,
              abi: PAYMASTER_FACTORY_ABI as Abi,
              functionName: "paymasterStake",
              args: [paymasterAddr],
            }),
          ]);

          return {
            address: paymasterAddr,
            token,
            stake,
            available: stake >= minStake,
          };
        } catch (error) {
          console.error(
            `[Paymaster] Error fetching details for ${paymasterAddr}:`,
            error,
          );
          return null;
        }
      }),
    );

    return paymasterDetails.filter(
      (pm): pm is PaymasterInfo => pm !== null && pm.available,
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Get paymaster for a specific token
 */
export async function getPaymasterForToken(
  tokenAddress: Address,
): Promise<Address | null> {
  if (
    PAYMASTER_FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000"
  ) {
    return null;
  }

  try {
    const client = getPublicClient();

    const paymaster = await safeReadContract<Address>(client, {
      address: PAYMASTER_FACTORY_ADDRESS,
      abi: PAYMASTER_FACTORY_ABI as Abi,
      functionName: "getPaymasterByToken",
      args: [tokenAddress],
    });

    // Verify paymaster has sufficient stake
    const stake = await safeReadContract<bigint>(client, {
      address: PAYMASTER_FACTORY_ADDRESS,
      abi: PAYMASTER_FACTORY_ABI as Abi,
      functionName: "paymasterStake",
      args: [paymaster],
    });

    if (stake >= MIN_STAKE_THRESHOLD) {
      return paymaster;
    }

    return null;
  } catch (error) {
    throw error;
  }
}

/**
 * Get quote for gas payment in specific token
 */
export async function getPaymasterQuote(
  paymasterAddress: Address,
  ethAmount: bigint,
): Promise<PaymasterQuote | null> {
  try {
    const client = getPublicClient();

    const [token, tokenAmount] = await Promise.all([
      safeReadContract<Address>(client, {
        address: paymasterAddress,
        abi: PAYMASTER_ABI as Abi,
        functionName: "token",
      }),
      safeReadContract<bigint>(client, {
        address: paymasterAddress,
        abi: PAYMASTER_ABI as Abi,
        functionName: "getQuote",
        args: [ethAmount],
      }),
    ]);

    return {
      paymaster: paymasterAddress,
      token,
      ethAmount,
      tokenAmount,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Generate ERC-4337 paymaster data
 * Format: paymasterAddress + verificationGasLimit + postOpGasLimit + paymasterData
 */
export function generatePaymasterData(
  paymasterAddress: Address,
  verificationGasLimit: bigint = BigInt(100000),
  postOpGasLimit: bigint = BigInt(50000),
): `0x${string}` {
  return encodePacked(
    ["address", "uint128", "uint128"],
    [paymasterAddress, BigInt(verificationGasLimit), BigInt(postOpGasLimit)],
  );
}

/**
 * Estimate gas cost in tokens for a transaction
 */
export async function estimateTokenCost(
  tokenAddress: Address,
  gasLimit: bigint,
  gasPrice: bigint,
): Promise<bigint | null> {
  const paymaster = await getPaymasterForToken(tokenAddress);
  if (!paymaster) {
    return null;
  }

  const ethCost = gasLimit * gasPrice;
  const quote = await getPaymasterQuote(paymaster, ethCost);

  return quote?.tokenAmount || null;
}

/**
 * Check if user has sufficient token balance for gas payment
 */
export async function canPayGasWithToken(
  userAddress: Address,
  tokenAddress: Address,
  requiredAmount: bigint,
): Promise<boolean> {
  try {
    const client = getPublicClient();

    const balance = await safeReadContract<bigint>(client, {
      address: tokenAddress,
      abi: parseAbi([
        "function balanceOf(address) view returns (uint256)",
      ]) as Abi,
      functionName: "balanceOf",
      args: [userAddress],
    });

    return balance >= requiredAmount;
  } catch (error) {
    throw error;
  }
}

// Export singleton instance
export const paymasterService = {
  getAvailablePaymasters,
  getPaymasterForToken,
  getPaymasterQuote,
  generatePaymasterData,
  estimateTokenCost,
  canPayGasWithToken,
};
