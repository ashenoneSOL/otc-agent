"use client";
import "@/app/globals.css";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { Footer } from "@/components/footer";

const DealsGrid = dynamic(
  () => import("@/components/deals-grid").then((m) => m.DealsGrid),
  { ssr: false },
);
const DealFilters = dynamic(
  () => import("@/components/deal-filters").then((m) => m.DealFilters),
  { ssr: false },
);

function MarketplaceContent() {
  const [filters, setFilters] = useState({
    chain: "all" as "all" | "ethereum" | "base" | "solana",
    minMarketCap: 0,
    maxMarketCap: 0,
    isNegotiable: "all" as "all" | "true" | "false",
    isFractionalized: "all" as "all" | "true" | "false",
  });
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <main className="flex-1 flex flex-col min-h-0 px-4 sm:px-6 py-4 sm:py-8">
      <div className="max-w-7xl mx-auto w-full flex flex-col min-h-0 flex-1">
        {/* Header - Fixed */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6 flex-shrink-0">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">OTC Marketplace</h1>
            <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mt-1 sm:mt-2">
              Discover discounted token deals with flexible lockups
            </p>
          </div>
          <button
            onClick={() => (window.location.href = "/consign")}
            className="px-4 py-2.5 sm:py-2 bg-orange-600 text-white text-sm sm:text-base rounded-lg hover:bg-orange-700 whitespace-nowrap w-full sm:w-auto"
          >
            List Your Tokens
          </button>
        </div>

        {/* Search Bar - Fixed */}
        <div className="mb-4 flex-shrink-0">
          <div className="relative">
            <input
              type="text"
              placeholder="Search tokens by name or symbol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 pl-10 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400"
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
          </div>
        </div>

        {/* Filters - Fixed */}
        <div className="mb-4 flex-shrink-0">
          <DealFilters filters={filters} onFiltersChange={setFilters} />
        </div>

        {/* Deals Grid - Scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <DealsGrid filters={filters} searchQuery={searchQuery} />
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <div className="text-xl text-zinc-600 dark:text-zinc-400">
                Loading OTC Marketplace...
              </div>
            </div>
          </div>
        }
      >
        <MarketplaceContent />
      </Suspense>
      <Footer />
    </>
  );
}
