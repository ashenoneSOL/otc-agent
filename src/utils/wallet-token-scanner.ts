/**
 * Wallet token scanner utilities
 * Scans user wallets for tokens without needing Alchemy or other API keys
 *
 * Strategy:
 * - Base: Check balances for popular tokens using multicall (no API key needed)
 * - Solana: Use native RPC to list all SPL tokens (no API key needed)
 */

import { PublicClient } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { POPULAR_BASE_TOKENS } from "./popular-base-tokens";
import type { Chain } from "@/config/chains";

export interface ScannedToken {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  logoUrl?: string;
  chain: Chain;
  isRegistered: boolean;
}

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Scan wallet for popular ERC20 tokens on Base
 * Uses multicall for efficiency - no API keys needed
 */
async function scanBaseTokens(
  address: string,
  publicClient: PublicClient,
  registeredAddresses: Set<string>,
): Promise<ScannedToken[]> {
  // Use multicall to check all balances in parallel
  const balanceCalls = POPULAR_BASE_TOKENS.map((token) => ({
    address: token.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf" as const,
    args: [address as `0x${string}`],
  }));

  const balanceResults = await publicClient.multicall({
    contracts: balanceCalls,
    allowFailure: true,
  });

  const tokens: ScannedToken[] = [];

  for (let i = 0; i < POPULAR_BASE_TOKENS.length; i++) {
    const result = balanceResults[i];
    const tokenInfo = POPULAR_BASE_TOKENS[i];

    if (result.status === "success" && result.result) {
      const balance = result.result as bigint;
      if (balance > 0n) {
        tokens.push({
          address: tokenInfo.address.toLowerCase(),
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          balance: balance.toString(),
          decimals: tokenInfo.decimals,
          logoUrl: tokenInfo.logoUrl,
          chain: "base",
          isRegistered: registeredAddresses.has(
            tokenInfo.address.toLowerCase(),
          ),
        });
      }
    }
  }

  return tokens;
}

/**
 * Scan wallet for all SPL tokens on Solana
 * Uses native RPC - no API keys needed
 */
async function scanSolanaTokens(
  address: string,
  registeredAddresses: Set<string>,
): Promise<ScannedToken[]> {
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  try {
    const publicKey = new PublicKey(address);

    // Get all token accounts for this wallet
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      {
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      },
    );

    const tokens: ScannedToken[] = [];

    for (const account of tokenAccounts.value) {
      const accountData = account.account.data.parsed.info;
      const balance = BigInt(accountData.tokenAmount.amount);

      if (balance === BigInt(0)) continue;

      // Get token metadata (mint address, decimals)
      const mintAddress = accountData.mint;
      const decimals = accountData.tokenAmount.decimals;

      tokens.push({
        address: mintAddress.toLowerCase(),
        symbol: "SPL", // Would need metadata service to get real symbol
        name: "SPL Token",
        balance: balance.toString(),
        decimals,
        chain: "solana",
        isRegistered: registeredAddresses.has(mintAddress.toLowerCase()),
      });
    }

    // Optionally enhance with Helius DAS API for better metadata
    if (process.env.HELIUS_API_KEY) {
      return await enhanceWithHelius(tokens, address);
    }

    return tokens;
  } catch (error) {
    console.error("Failed to scan Solana tokens:", error);
    throw error;
  }
}

/**
 * Enhance Solana tokens with metadata from Helius (optional)
 */
async function enhanceWithHelius(
  tokens: ScannedToken[],
  walletAddress: string,
): Promise<ScannedToken[]> {
  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey) return tokens;

  try {
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${heliusApiKey}`,
    );

    const data = await response.json();

    // Map Helius metadata to our tokens
    const enhancedTokens = tokens.map((token) => {
      const heliusToken = data.tokens?.find(
        (t: any) => t.mint.toLowerCase() === token.address,
      );

      if (heliusToken) {
        return {
          ...token,
          symbol: heliusToken.symbol || token.symbol,
          name: heliusToken.name || token.name,
          logoUrl: heliusToken.logoURI,
        };
      }

      return token;
    });

    return enhancedTokens;
  } catch (error) {
    console.warn("Failed to enhance with Helius:", error);
    return tokens;
  }
}

/**
 * Get registered token addresses from database
 */
async function getRegisteredAddresses(chain: Chain): Promise<Set<string>> {
  try {
    const response = await fetch(`/api/tokens?chain=${chain}`);
    const registeredTokens = await response.json();

    return new Set(
      registeredTokens.map((t: any) => t.contractAddress.toLowerCase()),
    );
  } catch (error) {
    console.error("Failed to fetch registered tokens:", error);
    return new Set();
  }
}

/**
 * Unified function to scan wallet for tokens on any supported chain
 * @param address Wallet address
 * @param chain Target blockchain
 * @param publicClient Viem public client (for Base)
 * @returns Array of tokens with balances (includes isRegistered flag)
 */
export async function scanWalletTokens(
  address: string,
  chain: Chain,
  publicClient?: PublicClient,
): Promise<ScannedToken[]> {
  if (!address) {
    throw new Error("Wallet address required");
  }

  // Get registered token addresses first
  const registeredAddresses = await getRegisteredAddresses(chain);

  let tokens: ScannedToken[];

  if (chain === "solana") {
    tokens = await scanSolanaTokens(address, registeredAddresses);
  } else if (chain === "base") {
    if (!publicClient) {
      throw new Error("Public client required for Base chain");
    }
    tokens = await scanBaseTokens(address, publicClient, registeredAddresses);
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  return tokens;
}

/**
 * Scan wallet on multiple chains simultaneously
 */
export async function scanWalletMultiChain(
  evmAddress?: string,
  solanaAddress?: string,
  publicClient?: PublicClient,
): Promise<Record<Chain, ScannedToken[]>> {
  const results: Record<string, ScannedToken[]> = {};

  const promises: Promise<void>[] = [];

  if (evmAddress && publicClient) {
    promises.push(
      scanWalletTokens(evmAddress, "base", publicClient).then((tokens) => {
        results.base = tokens;
      }),
    );
  }

  if (solanaAddress) {
    promises.push(
      scanWalletTokens(solanaAddress, "solana").then((tokens) => {
        results.solana = tokens;
      }),
    );
  }

  await Promise.all(promises);

  return results as Record<Chain, ScannedToken[]>;
}
