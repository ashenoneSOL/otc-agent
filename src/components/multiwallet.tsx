"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChainId, useDisconnect, useConnect, useAccount } from "wagmi";
import { base, baseSepolia, bsc, bscTestnet, localhost } from "wagmi/chains";
import {
  usePrivy,
  useWallets,
  type User as PrivyUser,
} from "@privy-io/react-auth";
import { SUPPORTED_CHAINS } from "@/config/chains";
import type { EVMChain } from "@/types";
import { useRenderTracker } from "@/utils/render-tracker";

type MultiWalletContextValue = {
  selectedEVMChain: EVMChain;
  setSelectedEVMChain: (chain: EVMChain) => void;
  isConnected: boolean;
  hasWallet: boolean;
  entityId: string | null;
  networkLabel: string;
  evmConnected: boolean;
  evmAddress: string | undefined;
  privyAuthenticated: boolean;
  privyReady: boolean;
  privyUser: PrivyUser | null;
  isFarcasterContext: boolean;
  paymentPairLabel: string;
  currentChainId: number | null;
  login: () => void;
  logout: () => Promise<void>;
  connectWallet: () => void;
  disconnect: () => Promise<void>;
};

const MultiWalletContext = createContext<MultiWalletContextValue | undefined>(
  undefined,
);

export function MultiWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useRenderTracker("MultiWalletProvider");

  const {
    ready: privyReady,
    authenticated: privyAuthenticated,
    user: privyUser,
    login,
    logout,
    connectWallet,
  } = usePrivy();

  const { wallets } = useWallets();
  const { disconnect: disconnectWagmi } = useDisconnect();
  const { connect: connectWagmi, connectors } = useConnect();
  const { isConnected: isWagmiConnected, address: wagmiAddress } = useAccount();
  const chainId = useChainId();

  const prevStateRef = useRef<string | null>(null);

  const privyEvmWallet = useMemo(
    () =>
      wallets.find(
        (w) => (w as { chainType?: string }).chainType === "ethereum",
      ),
    [wallets],
  );

  const linkedEvmAddress = useMemo(() => {
    if (!privyUser?.linkedAccounts) return undefined;
    const evmAccount = privyUser.linkedAccounts.find(
      (a) =>
        a.type === "wallet" &&
        (a as { chainType?: string }).chainType === "ethereum",
    );
    return (evmAccount as { address?: string })?.address;
  }, [privyUser?.linkedAccounts]);

  const hasActiveEvmWallet = !!privyEvmWallet || isWagmiConnected;
  const evmConnected = hasActiveEvmWallet || !!linkedEvmAddress;
  const evmAddress =
    privyEvmWallet?.address || wagmiAddress || linkedEvmAddress;

  const [selectedEVMChain, setSelectedEVMChainState] =
    useState<EVMChain>("jeju");

  const envDetectionRef = useRef(false);
  const farcasterAutoConnectRef = useRef(false);
  const [isFarcasterContext, setIsFarcasterContext] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || envDetectionRef.current) return;
    envDetectionRef.current = true;

    import("@farcaster/miniapp-sdk")
      .then(({ default: miniappSdk }) => {
        miniappSdk.context
          .then((context) => {
            if (context) {
              setIsFarcasterContext(true);
              miniappSdk.actions.ready();
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (farcasterAutoConnectRef.current) return;
    if (!isFarcasterContext || isWagmiConnected || !connectors?.length) return;

    const farcasterConnector = connectors.find(
      (c) => c.id === "farcasterMiniApp" || c.id === "farcasterFrame",
    );
    if (farcasterConnector) {
      farcasterAutoConnectRef.current = true;
      connectWagmi({ connector: farcasterConnector });
    }
  }, [isFarcasterContext, isWagmiConnected, connectors, connectWagmi]);

  const setSelectedEVMChain = useCallback(
    async (chain: EVMChain) => {
      setSelectedEVMChainState(chain);

      if (privyEvmWallet && evmConnected) {
        const targetChainId = SUPPORTED_CHAINS[chain]?.chainId;
        if (targetChainId) {
          try {
            const currentChainId = parseInt(
              privyEvmWallet.chainId.split(":")[1] || privyEvmWallet.chainId,
            );
            if (currentChainId !== targetChainId) {
              await privyEvmWallet.switchChain(targetChainId);
            }
          } catch {
            // Chain switch failed - not critical
          }
        }
      }
    },
    [privyEvmWallet, evmConnected],
  );

  const disconnect = useCallback(async () => {
    if (evmConnected) disconnectWagmi();
    await logout();

    if (typeof window !== "undefined") {
      localStorage.removeItem("wagmi.store");
      localStorage.removeItem("wagmi.cache");
      localStorage.removeItem("wagmi.recentConnectorId");
      localStorage.removeItem("privy:token");
      localStorage.removeItem("privy:refresh_token");
    }
  }, [evmConnected, disconnectWagmi, logout]);

  const hasWallet = evmConnected;
  const isConnected = hasWallet || privyAuthenticated;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const stateKey = JSON.stringify({
      evmConnected,
      hasWallet,
      evmAddress,
    });

    if (prevStateRef.current === stateKey) return;
    prevStateRef.current = stateKey;

    console.log("[MultiWallet] State changed:", {
      privyAuthenticated,
      privyReady,
      walletsCount: wallets.length,
      hasActiveEvmWallet,
      linkedEvmAddress,
      isWagmiConnected,
      evmConnected,
      evmAddress,
      hasWallet,
    });
  }, [
    evmConnected,
    hasWallet,
    evmAddress,
    hasActiveEvmWallet,
    privyAuthenticated,
    privyReady,
    wallets.length,
    linkedEvmAddress,
    isWagmiConnected,
  ]);

  const evmNetworkName = useMemo(() => {
    if (!chainId) return "Unknown";
    const chainNames: Record<number, string> = {
      [localhost.id]: "Anvil",
      [base.id]: "Base",
      [baseSepolia.id]: "Base Sepolia",
      [bsc.id]: "BSC",
      [bscTestnet.id]: "BSC Testnet",
      420689: "Jeju Devnet",
      420690: "Jeju Testnet",
      420691: "Jeju",
    };
    return chainNames[chainId] ?? `Chain ${chainId}`;
  }, [chainId]);

  const networkLabel = useMemo(() => {
    const chainNames: Record<string, string> = {
      base: "Base",
      bsc: "BSC",
      jeju: "Jeju",
      ethereum: "Ethereum",
    };
    if (evmConnected) {
      return chainNames[selectedEVMChain] || evmNetworkName;
    }
    if (privyAuthenticated) {
      return isFarcasterContext ? "Farcaster" : "Signed In";
    }
    return "Not connected";
  }, [
    selectedEVMChain,
    evmNetworkName,
    evmConnected,
    privyAuthenticated,
    isFarcasterContext,
  ]);

  const entityId = useMemo(() => {
    if (evmAddress) return evmAddress.toLowerCase();
    if (privyAuthenticated && privyUser?.id) return privyUser.id;
    return null;
  }, [evmAddress, privyAuthenticated, privyUser]);

  const paymentPairLabel = "USDC/ETH";

  const value = useMemo<MultiWalletContextValue>(
    () => ({
      selectedEVMChain,
      setSelectedEVMChain,
      isConnected,
      hasWallet,
      entityId,
      networkLabel,
      evmConnected,
      evmAddress,
      privyAuthenticated,
      privyReady,
      privyUser,
      isFarcasterContext,
      paymentPairLabel,
      currentChainId: chainId ?? null,
      login,
      logout,
      connectWallet,
      disconnect,
    }),
    [
      selectedEVMChain,
      setSelectedEVMChain,
      isConnected,
      hasWallet,
      entityId,
      networkLabel,
      evmConnected,
      evmAddress,
      privyAuthenticated,
      privyReady,
      privyUser,
      isFarcasterContext,
      paymentPairLabel,
      chainId,
      login,
      logout,
      connectWallet,
      disconnect,
    ],
  );

  return (
    <MultiWalletContext.Provider value={value}>
      {children}
    </MultiWalletContext.Provider>
  );
}

const defaultContextValue: MultiWalletContextValue = {
  selectedEVMChain: "jeju",
  setSelectedEVMChain: () => {},
  isConnected: false,
  hasWallet: false,
  entityId: null,
  networkLabel: "",
  evmConnected: false,
  evmAddress: undefined,
  privyAuthenticated: false,
  privyReady: false,
  privyUser: null,
  isFarcasterContext: false,
  paymentPairLabel: "",
  currentChainId: null,
  login: () => {},
  logout: async () => {},
  connectWallet: () => {},
  disconnect: async () => {},
};

export function useMultiWallet(): MultiWalletContextValue {
  const ctx = useContext(MultiWalletContext);
  return ctx ?? defaultContextValue;
}
