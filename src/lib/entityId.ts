// Entity ID utilities using Eliza's stringToUuid

import { stringToUuid } from "@elizaos/core";
import { isSolanaAddress } from "../utils/address-utils";

/**
 * Convert wallet address to deterministic UUID entity ID
 * Uses Eliza's built-in stringToUuid for consistency with runtime
 *
 * IMPORTANT: EVM addresses are case-insensitive (lowercased for consistency)
 * Solana addresses are case-sensitive (Base58 encoded, preserved as-is)
 */
export function walletToEntityId(address: string): string {
  const trimmed = address.trim();
  // Preserve case for Solana addresses, lowercase for EVM
  const normalized = isSolanaAddress(trimmed) ? trimmed : trimmed.toLowerCase();
  return stringToUuid(normalized) as string;
}
