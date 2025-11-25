/**
 * Wallet token scanner utilities
 * Scans user wallets for tokens without needing Alchemy or other API keys
 *
 * Strategy:
 * - Base: Check balances for popular tokens using multicall (no API key needed)
 * - Solana: Use native RPC to list all SPL tokens (no API key needed)
 */

import type { PublicClient, Address } from "viem";
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
 * Multicall result type for balance queries
 */
interface MulticallResult {
  status: "success" | "failure";
  result?: bigint;
  error?: Error;
}

/**
 * Scan wallet for popular ERC20 tokens on Base
 * Uses multicall for efficiency - no API keys needed
 */
async function scanBaseTokens(
  address: string,
  publicClient: PublicClient,
): Promise<ScannedToken[]> {
  // Use multicall to check all balances in parallel
  const balanceCalls = POPULAR_BASE_TOKENS.map((token) => ({
    address: token.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf" as const,
    args: [address as Address],
  }));

  // Type assertion needed due to viem's complex type inference with multicall
  // The multicall function has deeply nested generics that don't infer correctly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balanceResults = (await (publicClient as any).multicall({
    contracts: balanceCalls,
    allowFailure: true,
  })) as MulticallResult[];

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
          isRegistered: false, // Applied later
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
async function scanSolanaTokens(address: string): Promise<ScannedToken[]> {
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const publicKey = new PublicKey(address);

  // Scan both Token Program and Token 2022 Program in parallel
  const [tokenAccounts, token2022Accounts] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }),
    connection
      .getParsedTokenAccountsByOwner(publicKey, {
        programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
      })
      .catch(() => ({ value: [] })), // Fail safe for Token 2022 on some RPCs
  ]);

  const tokens: ScannedToken[] = [];
  const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value];

  for (const account of allAccounts) {
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
      isRegistered: false, // Applied later
    });
  }

  // Optionally enhance with Helius DAS API for better metadata
  if (process.env.HELIUS_API_KEY) {
    return await enhanceWithHelius(tokens, address);
  }

  return tokens;
}

/**
 * Enhance Solana tokens with metadata from Helius (optional)
 * Gracefully degrades to original tokens if Helius API fails
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
    interface HeliusToken {
      mint: string;
      symbol?: string;
      name?: string;
      logoURI?: string;
    }
    const enhancedTokens = tokens.map((token) => {
      const heliusToken = (data.tokens as HeliusToken[] | undefined)?.find(
        (t) => t.mint.toLowerCase() === token.address,
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
  } catch {
    // Graceful degradation: return original tokens if Helius API fails
    return tokens;
  }
}

/**
 * Get registered token addresses from database
 * Returns empty set on failure to allow scanner to continue
 */
async function getRegisteredAddresses(chain: Chain): Promise<Set<string>> {
  try {
    const response = await fetch(`/api/tokens?chain=${chain}`);
    const registeredTokens: Array<{ contractAddress: string }> =
      await response.json();

    return new Set(
      registeredTokens.map((t) => t.contractAddress.toLowerCase()),
    );
  } catch {
    // Graceful degradation: return empty set if API fails
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

  // Start fetching registered addresses immediately
  const registeredAddressesPromise = getRegisteredAddresses(chain);

  let tokensPromise: Promise<ScannedToken[]>;

  if (chain === "solana") {
    // For Solana, we pass an empty set initially and filter later,
    // but the internal function expects the set.
    // Refactor: Pass the promise or wait here.
    // To keep signatures clean, we'll wait for registeredAddresses inside the parallel block logic?
    // No, scan functions take the Set.
    // So we must wait for registeredAddresses or refactor scan functions.
    // Actually, scan functions doing the filtering is efficient.
    // But waiting for API call blocks the RPC call.

    // Better: Launch RPC calls immediately, then filter with the result of the API call.
    tokensPromise = scanSolanaTokens(address);
  } else if (chain === "base") {
    if (!publicClient) {
      throw new Error("Public client required for Base chain");
    }
    // Base scanner needs the list of tokens to scan?
    // No, scanBaseTokens uses POPULAR_BASE_TOKENS constant.
    // It uses registeredAddresses only for the 'isRegistered' flag.
    tokensPromise = scanBaseTokens(address, publicClient);
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Wait for both
  const [registeredAddresses, tokens] = await Promise.all([
    registeredAddressesPromise,
    tokensPromise,
  ]);

  // Apply registration status
  // Note: scanSolanaTokens and scanBaseTokens previously took the Set and applied it internally.
  // I need to update them to NOT take the set, and return raw tokens, then apply here.
  // This allows parallel execution.

  return tokens.map((t) => ({
    ...t,
    isRegistered: registeredAddresses.has(t.address),
  }));
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
