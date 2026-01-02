"use client";

/**
 * useWalletAuth - Sign messages for API authentication
 *
 * Provides wallet signing for both EVM (via wagmi) and Solana wallets.
 * Used to generate auth headers for protected API routes.
 */

import { useWallets } from "@privy-io/react-auth";
import bs58 from "bs58";
import { useCallback, useMemo } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useChain, useWalletConnection } from "@/contexts";
import type { WalletAuthHeaders } from "@/hooks/mutations/useConsignmentMutations";

const AUTH_MESSAGE_PREFIX = "Authorize OTC action at ";

interface UseWalletAuthReturn {
  /** Generate auth headers by signing a message */
  getAuthHeaders: () => Promise<WalletAuthHeaders>;
  /** Whether the wallet can sign messages */
  canSign: boolean;
  /** Whether we're on an EVM chain */
  isEvm: boolean;
  /** Whether we're on Solana */
  isSolana: boolean;
}

/**
 * Hook to sign messages for API authentication
 *
 * @example
 * ```tsx
 * const { getAuthHeaders, canSign } = useWalletAuth();
 *
 * const handleSubmit = async () => {
 *   if (!canSign) throw new Error("Wallet cannot sign");
 *   const auth = await getAuthHeaders();
 *   await createConsignment({ ...data, walletAuth: auth });
 * };
 * ```
 */
export function useWalletAuth(): UseWalletAuthReturn {
  const { activeFamily } = useChain();
  // Get solanaWallet which now includes signMessage from the adapter
  const { evmAddress, solanaPublicKey, solanaWallet } = useWalletConnection();
  const { wallets } = useWallets();
  const { address: wagmiAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const isEvm = activeFamily === "evm";
  const isSolana = activeFamily === "solana";

  // Get the Privy EVM wallet for signing
  const privyEvmWallet = useMemo(() => {
    return wallets.find((w) => {
      const typed = w as { chainType?: string; address?: string };
      return typed.chainType === "ethereum";
    });
  }, [wallets]);

  // Check if Solana wallet can sign messages
  const solanaCanSignMessages = useMemo(() => {
    return solanaWallet !== null && typeof solanaWallet.signMessage === "function";
  }, [solanaWallet]);

  const canSign = useMemo(() => {
    if (isEvm) {
      // Can sign if we have wagmi connected or Privy EVM wallet
      return !!(wagmiAddress || privyEvmWallet);
    }
    if (isSolana) {
      // Can sign if Solana wallet has signMessage capability
      return solanaCanSignMessages;
    }
    return false;
  }, [isEvm, isSolana, wagmiAddress, privyEvmWallet, solanaCanSignMessages]);

  const getAuthHeaders = useCallback(async (): Promise<WalletAuthHeaders> => {
    const timestamp = Date.now().toString();
    const message = `${AUTH_MESSAGE_PREFIX}${timestamp}`;

    if (isEvm) {
      const address = evmAddress || wagmiAddress;
      if (!address) {
        throw new Error("No EVM wallet connected");
      }

      // Try wagmi signMessage first (works with injected wallets)
      let signature: string;
      try {
        signature = await signMessageAsync({ message });
      } catch (wagmiError) {
        // Fallback to Privy wallet signing
        if (privyEvmWallet) {
          const provider = await (
            privyEvmWallet as {
              getEthereumProvider: () => Promise<{
                request: (args: { method: string; params: unknown[] }) => Promise<string>;
              }>;
            }
          ).getEthereumProvider();
          signature = await provider.request({
            method: "personal_sign",
            params: [message, address],
          });
        } else {
          throw wagmiError;
        }
      }

      return {
        address,
        signature,
        message,
        timestamp,
      };
    }

    if (isSolana) {
      if (!solanaPublicKey) {
        throw new Error("No Solana wallet connected");
      }
      if (!solanaWallet?.signMessage) {
        throw new Error("Solana wallet does not support message signing");
      }

      // Encode message to Uint8Array for Solana signing
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await solanaWallet.signMessage(messageBytes);

      // Encode signature as base58 (standard for Solana)
      const signature = bs58.encode(signatureBytes);

      return {
        address: solanaPublicKey,
        signature,
        message,
        timestamp,
      };
    }

    throw new Error("No wallet family active");
  }, [
    isEvm,
    isSolana,
    evmAddress,
    wagmiAddress,
    solanaPublicKey,
    solanaWallet,
    signMessageAsync,
    privyEvmWallet,
  ]);

  return {
    getAuthHeaders,
    canSign,
    isEvm,
    isSolana,
  };
}
