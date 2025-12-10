"use client";

import { useEffect } from "react";
import { getChainConfig, type Chain } from "@/config/chains";

export function useDeploymentValidation() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;

    const chains: Chain[] = ["base", "jeju"];
    const missing: string[] = [];

    for (const chain of chains) {
      const config = getChainConfig(chain);
      if (!config.contracts.otc) missing.push(`${chain} (OTC Contract)`);
    }

    if (missing.length > 0) {
      console.error(
        `Missing deployment configuration for: ${missing.join(", ")}. ` +
          `Please ensure deployment JSONs are present in src/config/deployments/ or env vars are set.`,
      );
    }
  }, []);
}
