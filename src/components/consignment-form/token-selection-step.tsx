"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { useMultiWallet } from "../multiwallet";
import type { Token } from "@/services/database";
import { Button } from "../button";

interface StepProps {
  formData: any;
  updateFormData: (updates: any) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function TokenSelectionStep({
  formData,
  updateFormData,
  onNext,
}: StepProps) {
  const { activeFamily } = useMultiWallet();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTokens() {
      const chain = activeFamily === "solana" ? "solana" : "base";
      const response = await fetch(`/api/tokens?chain=${chain}&isActive=true`);
      const data = await response.json();
      if (data.success) {
        setTokens(data.tokens);
      }
      setLoading(false);
    }
    loadTokens();
  }, [activeFamily]);

  const uniqueTokens = useMemo(() => {
    const seen = new Map<string, Token>();
    tokens.forEach(token => {
      const key = `${token.chain}-${token.contractAddress.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, token);
      }
    });
    return Array.from(seen.values());
  }, [tokens]);

  if (loading) {
    return <div>Loading tokens...</div>;
  }

  return (
    <div className="space-y-4">
      {uniqueTokens.map((token) => (
        <div
          key={`${token.chain}-${token.contractAddress}`}
          onClick={() => updateFormData({ tokenId: token.id })}
          className={`p-4 rounded-lg border cursor-pointer transition-colors ${
            formData.tokenId === token.id
              ? "border-orange-600 bg-orange-600/5"
              : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
          }`}
        >
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
            <div className="flex-1">
              <div className="font-semibold">{token.symbol}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {token.name}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-500 font-mono mt-1">
                {token.contractAddress.slice(0, 6)}...{token.contractAddress.slice(-4)}
              </div>
            </div>
          </div>
        </div>
      ))}

      <Button
        onClick={onNext}
        disabled={!formData.tokenId}
        className="w-full mt-6"
      >
        Next
      </Button>
    </div>
  );
}
