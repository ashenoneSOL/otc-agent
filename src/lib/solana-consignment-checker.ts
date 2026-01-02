/**
 * Solana Consignment Availability Checker
 *
 * Checks on-chain status of Solana consignments to detect inactive/withdrawn listings.
 * Uses in-memory cache to avoid repeated RPC calls for known-unavailable consignments.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SUPPORTED_CHAINS } from "@/config/chains";
import idl from "@/contracts/solana-otc.idl.json";

// Cache TTL for unavailable consignments (24 hours)
const UNAVAILABLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Cache TTL for available consignments (5 minutes - recheck periodically)
const AVAILABLE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  isActive: boolean;
  checkedAt: number;
  remainingAmount?: string;
}

// Server-side cache for consignment status
// Key: contractConsignmentId (Solana address)
const statusCache = new Map<string, CacheEntry>();

/**
 * Check if a Solana consignment is active on-chain
 * Returns { isActive, remainingAmount } or throws on RPC error
 */
export async function checkSolanaConsignmentStatus(
  contractConsignmentId: string,
): Promise<{ isActive: boolean; remainingAmount: string }> {
  // Check cache first
  const cached = statusCache.get(contractConsignmentId);
  if (cached) {
    const age = Date.now() - cached.checkedAt;
    const ttl = cached.isActive ? AVAILABLE_CACHE_TTL_MS : UNAVAILABLE_CACHE_TTL_MS;
    if (age < ttl) {
      return {
        isActive: cached.isActive,
        remainingAmount: cached.remainingAmount ?? "0",
      };
    }
  }

  // Fetch from chain
  const rpcUrl = SUPPORTED_CHAINS.solana.rpcUrl;
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: undefined, // Disable WebSocket
  });

  const consignmentPubkey = new PublicKey(contractConsignmentId);

  // Create minimal provider for reading accounts (no wallet needed)
  // Use Keypair.generate() for dummy wallet with required payer property
  const dummyKeypair = Keypair.generate();
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: dummyKeypair.publicKey,
      signTransaction: async () => {
        throw new Error("Read-only provider");
      },
      signAllTransactions: async () => {
        throw new Error("Read-only provider");
      },
      payer: dummyKeypair,
    } as anchor.Wallet,
    { commitment: "confirmed" },
  );

  const program = new anchor.Program(idl as anchor.Idl, provider);

  // Fetch consignment account
  interface ConsignmentAccount {
    isActive: boolean;
    remainingAmount: anchor.BN;
  }

  interface ConsignmentAccountMethods {
    consignment: {
      fetch: (addr: PublicKey) => Promise<ConsignmentAccount>;
      fetchNullable: (addr: PublicKey) => Promise<ConsignmentAccount | null>;
    };
  }

  const accountMethods = program.account as ConsignmentAccountMethods;

  // Use fetchNullable to handle case where account doesn't exist
  const consignmentAccount = await accountMethods.consignment.fetchNullable(consignmentPubkey);

  if (!consignmentAccount) {
    // Account doesn't exist - treat as inactive
    const result = { isActive: false, remainingAmount: "0" };
    statusCache.set(contractConsignmentId, {
      isActive: false,
      checkedAt: Date.now(),
      remainingAmount: "0",
    });
    return result;
  }

  const isActive = consignmentAccount.isActive;
  const remainingAmount = consignmentAccount.remainingAmount.toString();

  // Cache the result
  statusCache.set(contractConsignmentId, {
    isActive,
    checkedAt: Date.now(),
    remainingAmount,
  });

  return { isActive, remainingAmount };
}

/**
 * Batch check multiple Solana consignments
 * Returns a map of contractConsignmentId -> { isActive, remainingAmount }
 */
export async function batchCheckSolanaConsignments(
  contractConsignmentIds: string[],
): Promise<Map<string, { isActive: boolean; remainingAmount: string }>> {
  const results = new Map<string, { isActive: boolean; remainingAmount: string }>();

  // Filter out cached entries that are still fresh
  const toCheck: string[] = [];

  for (const id of contractConsignmentIds) {
    const cached = statusCache.get(id);
    if (cached) {
      const age = Date.now() - cached.checkedAt;
      const ttl = cached.isActive ? AVAILABLE_CACHE_TTL_MS : UNAVAILABLE_CACHE_TTL_MS;
      if (age < ttl) {
        results.set(id, {
          isActive: cached.isActive,
          remainingAmount: cached.remainingAmount ?? "0",
        });
        continue;
      }
    }
    toCheck.push(id);
  }

  if (toCheck.length === 0) {
    return results;
  }

  // Check remaining in parallel (with concurrency limit)
  const BATCH_SIZE = 10;
  for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
    const batch = toCheck.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((id) => checkSolanaConsignmentStatus(id)),
    );

    for (let j = 0; j < batch.length; j++) {
      const id = batch[j];
      const result = batchResults[j];
      if (!id) continue;

      if (result && result.status === "fulfilled") {
        results.set(id, result.value);
      } else {
        // On error, assume available (don't hide listing due to RPC issues)
        console.warn(
          `[SolanaChecker] Failed to check ${id}:`,
          result && result.status === "rejected" ? result.reason : "unknown error",
        );
        results.set(id, { isActive: true, remainingAmount: "0" });
      }
    }
  }

  return results;
}

/**
 * Mark a consignment as unavailable in the cache
 * Called when a BadState error is encountered during transaction
 */
export function markConsignmentUnavailable(contractConsignmentId: string): void {
  statusCache.set(contractConsignmentId, {
    isActive: false,
    checkedAt: Date.now(),
    remainingAmount: "0",
  });
}

/**
 * Clear the cache (for testing)
 */
export function clearConsignmentStatusCache(): void {
  statusCache.clear();
}

/**
 * Get cache statistics (for debugging)
 */
export function getConsignmentCacheStats(): {
  size: number;
  unavailableCount: number;
  availableCount: number;
} {
  let unavailableCount = 0;
  let availableCount = 0;

  for (const entry of statusCache.values()) {
    if (entry.isActive) {
      availableCount++;
    } else {
      unavailableCount++;
    }
  }

  return {
    size: statusCache.size,
    unavailableCount,
    availableCount,
  };
}
