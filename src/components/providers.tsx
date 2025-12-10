"use client";

import { MultiWalletProvider } from "@/components/multiwallet";
import { ChainResetMonitor } from "@/components/chain-reset-monitor";
import { MiniappProvider } from "@/components/miniapp-provider";
import { config, chains } from "@/lib/wagmi-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { PrivyProvider, type WalletListEntry } from "@privy-io/react-auth";
import { useRenderTracker } from "@/utils/render-tracker";

const COINBASE_BLUE = "#0052ff" as `#${string}`;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      gcTime: 60000,
      refetchOnWindowFocus: true,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  useRenderTracker("Providers");

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!privyAppId) {
    throw new Error(
      "NEXT_PUBLIC_PRIVY_APP_ID is required. Please add it to your .env.local file.",
    );
  }

  const privyConfig = useMemo(
    () => ({
      loginMethods: ["farcaster", "wallet"] as ("farcaster" | "wallet")[],
      appearance: {
        theme: "light" as const,
        accentColor: COINBASE_BLUE,
        walletChainType: "ethereum-only" as const,
        walletList: [
          "detected_ethereum_wallets",
          "wallet_connect",
        ] as WalletListEntry[],
      },
      embeddedWallets: {
        ethereum: {
          createOnLogin: "users-without-wallets" as const,
        },
      },
      defaultChain: chains[0],
      supportedChains: chains,
    }),
    [],
  );

  if (!mounted) {
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MiniappProvider>
        <PrivyProvider appId={privyAppId} config={privyConfig}>
          <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
              <MultiWalletProvider>
                <ChainResetMonitor />
                {children}
              </MultiWalletProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </PrivyProvider>
      </MiniappProvider>
    </ThemeProvider>
  );
}
