"use client";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import { useMemo } from "react";

/**
 * Get Solana network environment consistent with config/chains.ts
 */
function getSolanaNetwork(): WalletAdapterNetwork {
  // Check for explicit mainnet flag (same as config/chains.ts)
  if (process.env.NEXT_PUBLIC_USE_MAINNET === "true") {
    return WalletAdapterNetwork.Mainnet;
  }

  // Development uses devnet (or localnet if configured)
  if (process.env.NODE_ENV === "development") {
    return WalletAdapterNetwork.Devnet;
  }

  // Production defaults to testnet unless mainnet flag is set
  return WalletAdapterNetwork.Devnet;
}

/**
 * Get Solana RPC endpoint, preferring custom RPC if set
 */
function getSolanaEndpoint(network: WalletAdapterNetwork): string {
  // Use custom RPC if configured (for localnet or custom nodes)
  const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC;
  if (customRpc) {
    return customRpc;
  }

  return clusterApiUrl(network);
}

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const network = useMemo(() => getSolanaNetwork(), []);
  const endpoint = useMemo(() => getSolanaEndpoint(network), [network]);

  // Debug: Log when provider mounts
  console.log("[SolanaConnectionProvider] Provider initialized with:", {
    network,
    endpoint,
  });

  return (
    <ConnectionProvider endpoint={endpoint}>{children}</ConnectionProvider>
  );
}
