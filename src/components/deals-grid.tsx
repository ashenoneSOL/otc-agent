"use client";

import { useEffect, useMemo, useState, memo } from "react";
import { TokenDealsSection } from "./token-deals-section";
import { useTokenCache } from "@/hooks/useTokenCache";
import { useRenderTracker } from "@/utils/render-tracker";
import type {
  OTCConsignment,
  Token,
  TokenMarketData,
} from "@/services/database";

interface DealsGridProps {
  filters: {
    chains: string[];
    minMarketCap: number;
    maxMarketCap: number;
    negotiableTypes: string[];
    isFractionalized: boolean;
  };
  searchQuery?: string;
}

interface TokenGroup {
  tokenId: string;
  token: Token | null;
  marketData: TokenMarketData | null;
  consignments: OTCConsignment[];
}

// --- Helper: Group consignments by tokenId ---
function groupConsignmentsByToken(
  consignments: OTCConsignment[],
): TokenGroup[] {
  // Deduplicate by ID
  const uniqueMap = new Map(consignments.map((c) => [c.id, c]));
  const unique = Array.from(uniqueMap.values());

  // Group by tokenId
  const grouped = new Map<string, TokenGroup>();
  for (const consignment of unique) {
    let group = grouped.get(consignment.tokenId);
    if (!group) {
      group = {
        tokenId: consignment.tokenId,
        token: null,
        marketData: null,
        consignments: [],
      };
      grouped.set(consignment.tokenId, group);
    }
    group.consignments.push(consignment);
  }

  return Array.from(grouped.values());
}

const TokenGroupLoader = memo(function TokenGroupLoader({ tokenGroup }: { tokenGroup: TokenGroup }) {
  useRenderTracker("TokenGroupLoader", { tokenId: tokenGroup.tokenId });
  
  const { token, marketData: cachedMarketData, isLoading } = useTokenCache(
    tokenGroup.tokenId,
  );
  
  // Show loading skeleton while fetching token
  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 animate-pulse">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>
          <div className="flex-1">
            <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-32 mb-2"></div>
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-48"></div>
          </div>
        </div>
      </div>
    );
  }
  
  // If token failed to load, show minimal fallback with tokenId
  if (!token) {
    const parts = tokenGroup.tokenId.split("-");
    const chain = parts[1] || "unknown";
    const address = parts[2] || tokenGroup.tokenId;
    const shortAddress = address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
    
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-lg font-bold">
              ?
            </div>
            <div>
              <h3 className="text-lg font-semibold">{shortAddress}</h3>
              <span className="text-sm text-zinc-500">{chain.toUpperCase()} Token</span>
            </div>
          </div>
        </div>
        <div className="p-4 text-sm text-zinc-500">
          {tokenGroup.consignments.length} listing(s) available
        </div>
      </div>
    );
  }
  
  return (
    <TokenDealsSection
      token={token}
      marketData={cachedMarketData}
      consignments={tokenGroup.consignments}
    />
  );
});

export function DealsGrid({ filters, searchQuery = "" }: DealsGridProps) {
  useRenderTracker("DealsGrid", { searchQuery, chainsCount: filters.chains.length });
  const [tokenGroups, setTokenGroups] = useState<TokenGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadConsignments() {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        filters.chains.forEach((chain) => params.append("chains", chain));
        filters.negotiableTypes.forEach((type) =>
          params.append("negotiableTypes", type),
        );
        if (filters.isFractionalized) params.append("isFractionalized", "true");

        const response = await fetch(`/api/consignments?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          const consignmentsList = (data.consignments ||
            []) as OTCConsignment[];
          setTokenGroups(groupConsignmentsByToken(consignmentsList));
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadConsignments();
  }, [filters]);

  // Filter token groups by search query (memoized)
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return tokenGroups;
    const query = searchQuery.toLowerCase();
    return tokenGroups.filter((group) =>
      group.tokenId.toLowerCase().includes(query),
    );
  }, [tokenGroups, searchQuery]);

  if (isLoading) {
    return (
      <div className="space-y-6 pb-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 animate-pulse"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>
              <div className="flex-1">
                <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-32 mb-2"></div>
                <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-48"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredGroups.length === 0 && searchQuery) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-zinc-400 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
          No results found
        </h3>
        <p className="text-zinc-600 dark:text-zinc-400">
          No tokens match &quot;{searchQuery}&quot;. Try a different search
          term.
        </p>
      </div>
    );
  }

  if (filteredGroups.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No OTC deals match your filters. Try adjusting the filters or be the
          first to list a deal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {filteredGroups.map((group) => (
        <TokenGroupLoader key={group.tokenId} tokenGroup={group} />
      ))}
    </div>
  );
}
