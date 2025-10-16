"use client";

import { useEffect, useState } from "react";
import { ConsignmentCard } from "./consignment-card";
import type { OTCConsignment, Token } from "@/services/database";

interface DealsGridProps {
  filters: {
    chain: string;
    minMarketCap: number;
    maxMarketCap: number;
    isNegotiable: string;
    isFractionalized: string;
  };
  searchQuery?: string;
}

interface ConsignmentWithToken extends OTCConsignment {
  _token?: Token;
}

export function DealsGrid({ filters, searchQuery = "" }: DealsGridProps) {
  const [consignments, setConsignments] = useState<ConsignmentWithToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadConsignments() {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (filters.chain !== "all") params.append("chain", filters.chain);
      if (filters.isNegotiable !== "all")
        params.append("isNegotiable", filters.isNegotiable);

      const response = await fetch(`/api/consignments?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        const consignmentsList = data.consignments || [];
        // Deduplicate by ID
        const uniqueConsignments = Array.from(
          new Map(consignmentsList.map((c: OTCConsignment) => [c.id, c])).values()
        );
        
        // Fetch token data for each consignment to enable search by name/symbol
        const consignmentsWithTokens = await Promise.all(
          uniqueConsignments.map(async (c) => {
            const tokenResponse = await fetch(`/api/tokens/${c.tokenId}`);
            const tokenData = await tokenResponse.json();
            return {
              ...c,
              _token: tokenData.success ? tokenData.token : undefined,
            };
          })
        );
        
        console.log("[DealsGrid] Loaded consignments:", {
          total: consignmentsList.length,
          unique: uniqueConsignments.length,
          ids: uniqueConsignments.map(c => c.id),
        });
        setConsignments(consignmentsWithTokens);
      }
      setIsLoading(false);
    }

    loadConsignments();
  }, [filters]);

  // Filter consignments by search query (case-insensitive, search across tokenId, name, and symbol)
  const filteredConsignments = consignments.filter((consignment) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const tokenId = consignment.tokenId.toLowerCase();
    const tokenName = consignment._token?.name?.toLowerCase() || "";
    const tokenSymbol = consignment._token?.symbol?.toLowerCase() || "";
    return tokenId.includes(query) || tokenName.includes(query) || tokenSymbol.includes(query);
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 animate-pulse"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>
              <div className="flex-1">
                <div className="h-5 bg-zinc-200 dark:bg-zinc-800 rounded w-24 mb-2"></div>
                <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-32"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
              <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4"></div>
              <div className="h-10 bg-zinc-200 dark:bg-zinc-800 rounded mt-4"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredConsignments.length === 0 && searchQuery) {
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
          No tokens match "{searchQuery}". Try a different search term.
        </p>
      </div>
    );
  }

  if (filteredConsignments.length === 0) {
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-6">
      {filteredConsignments.map((consignment) => (
        <ConsignmentCard key={consignment.id} consignment={consignment} />
      ))}
    </div>
  );
}



