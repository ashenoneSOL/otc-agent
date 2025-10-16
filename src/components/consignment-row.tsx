"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import type {
  OTCConsignment,
  Token,
} from "@/services/database";
import { Button } from "./button";

interface ConsignmentRowProps {
  consignment: OTCConsignment;
  onUpdate?: () => void;
}

export function ConsignmentRow({ consignment, onUpdate }: ConsignmentRowProps) {
  const [token, setToken] = useState<Token | null>(null);
  const [dealCount, setDealCount] = useState<number>(0);
  const fetchedTokenId = useRef<string | null>(null);

  useEffect(() => {
    // Only fetch if tokenId changed
    if (fetchedTokenId.current === consignment.tokenId) return;
    
    async function loadData() {
      fetchedTokenId.current = consignment.tokenId;
      const tokenRes = await fetch(`/api/tokens/${consignment.tokenId}`);
      const tokenData = await tokenRes.json();
      if (tokenData.success) setToken(tokenData.token);

      const totalAmount = BigInt(consignment.totalAmount);
      const remainingAmount = BigInt(consignment.remainingAmount);
      const soldAmount = totalAmount - remainingAmount;
      if (soldAmount > 0n && consignment.isFractionalized) {
        const avgDealSize = BigInt(consignment.minDealAmount) + BigInt(consignment.maxDealAmount);
        const estimatedDeals = Number(soldAmount / (avgDealSize / 2n));
        setDealCount(Math.max(1, estimatedDeals));
      }
    }
    loadData();
  }, [consignment.tokenId, consignment.totalAmount, consignment.remainingAmount, consignment.isFractionalized, consignment.minDealAmount, consignment.maxDealAmount]);

  if (!token) return null;

  const formatAmount = (amount: string) => {
    const num = Number(amount) / 1e18;
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  const percentRemaining =
    (Number(consignment.remainingAmount) / Number(consignment.totalAmount)) *
    100;

  const handlePause = async () => {
    await fetch(`/api/consignments/${consignment.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: consignment.status === "active" ? "paused" : "active",
      }),
    });
    
    // Refresh parent component state instead of full page reload
    if (onUpdate) {
      onUpdate();
    }
  };

  const handleWithdraw = async () => {
    if (!confirm("Withdraw remaining tokens? This cannot be undone.")) return;

    await fetch(`/api/consignments/${consignment.id}`, {
      method: "DELETE",
    });
    
    // Refresh parent component state instead of full page reload
    if (onUpdate) {
      onUpdate();
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {token.logoUrl && (
            <Image
              src={token.logoUrl}
              alt={token.symbol}
              width={40}
              height={40}
              className="w-10 h-10 rounded-full"
            />
          )}
          <div>
            <h3 className="font-semibold">{token.symbol}</h3>
            <p className="text-sm text-zinc-500">{token.name}</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {consignment.isNegotiable ? (
            <span className="inline-flex items-center rounded-full bg-blue-600/15 text-blue-700 dark:text-blue-400 px-3 py-1 text-xs font-medium">
              Negotiable
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 px-3 py-1 text-xs font-medium">
              Fixed
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              consignment.status === "active"
                ? "bg-orange-600/15 text-orange-700 dark:text-orange-400"
                : "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {consignment.status}
          </span>
          <Button
            color="red"
            onClick={handleWithdraw}
            disabled={consignment.status === "withdrawn"}
            className="!py-2 !px-4 !text-xs bg-zinc-900 text-white"
          >
            Withdraw
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Total</div>
          <div className="font-medium">
            {formatAmount(consignment.totalAmount)}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Remaining
          </div>
          <div className="font-medium">
            {formatAmount(consignment.remainingAmount)}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Deals</div>
          <div className="font-medium">{dealCount}</div>
        </div>
        <div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">% Sold</div>
          <div className="font-medium">
            {(100 - percentRemaining).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="bg-zinc-100 dark:bg-zinc-900 rounded-full h-2">
        <div
          className="bg-orange-600 rounded-full h-2"
          style={{ width: `${100 - percentRemaining}%` }}
        />
      </div>
    </div>
  );
}
