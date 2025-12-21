/**
 * Shared wallet utility functions
 * Centralized location for wallet-related operations to maintain DRY principle
 */

/**
 * Clear all wallet-related caches from localStorage
 * Used during logout, chain reset, or nonce error recovery
 *
 * Clears:
 * - wagmi.store - Wagmi persisted state
 * - wagmi.cache - Wagmi cached data
 * - wagmi.recentConnectorId - Last used connector
 * - privy:token - Privy auth token
 * - privy:refresh_token - Privy refresh token
 */
export function clearWalletCaches(): void {
  if (typeof window === "undefined") return;

  localStorage.removeItem("wagmi.store");
  localStorage.removeItem("wagmi.cache");
  localStorage.removeItem("wagmi.recentConnectorId");
  localStorage.removeItem("privy:token");
  localStorage.removeItem("privy:refresh_token");
}

/**
 * Clear wallet caches and reload the page after a delay
 * Used for recovering from chain resets or nonce errors
 *
 * @param delayMs - Delay before reloading (default: 500ms)
 */
export function clearWalletCachesAndReload(delayMs = 500): void {
  clearWalletCaches();

  if (typeof window !== "undefined") {
    setTimeout(() => {
      window.location.reload();
    }, delayMs);
  }
}
