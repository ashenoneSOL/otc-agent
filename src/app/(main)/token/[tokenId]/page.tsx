"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamicImport from "next/dynamic";
import { TokenHeader } from "@/components/token-header";
import { Footer } from "@/components/footer";
import type { Token, TokenMarketData } from "@/services/database";

const Chat = dynamicImport(() => import("@/components/chat"), { ssr: false });

export const dynamic = "force-dynamic";

const PRICE_REFRESH_INTERVAL = 30000; // 30 seconds

export default function TokenPage() {
  const params = useParams();
  const tokenId = params.tokenId as string;
  const [token, setToken] = useState<Token | null>(null);
  const [marketData, setMarketData] = useState<TokenMarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTokenData() {
      const response = await fetch(`/api/tokens/${tokenId}`);
      const data = await response.json();

      if (data.success) {
        setToken(data.token);
        setMarketData(data.marketData);
      }
      setLoading(false);
    }

    async function refreshMarketData() {
      if (!token) return;
      
      const response = await fetch(`/api/market-data/${tokenId}`);
      const data = await response.json();
      
      if (data.success && data.marketData) {
        setMarketData(data.marketData);
      }
    }

    loadTokenData();

    const interval = setInterval(refreshMarketData, PRICE_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [tokenId, token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <div className="text-xl text-zinc-600 dark:text-zinc-400">
            Loading token data...
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Token Not Found</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            This token may not be registered yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 flex flex-col min-h-0">
        <div className="px-3 sm:px-4 md:px-6 pt-3 sm:pt-4">
          <div className="max-w-7xl mx-auto">
            <TokenHeader token={token} marketData={marketData} />
          </div>
        </div>
        
        <div className="flex-1 flex flex-col min-h-0 px-3 sm:px-4 md:px-6 pb-3 sm:pb-4">
          <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0">
            <h2 className="text-sm font-semibold mb-2 px-1 text-zinc-600 dark:text-zinc-400">Negotiate a Deal</h2>
            <div className="flex-1 min-h-0">
              <Chat />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
