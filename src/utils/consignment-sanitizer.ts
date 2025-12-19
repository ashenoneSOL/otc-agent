import type { OTCConsignment } from "@/services/database";

// Sensitive fields that reveal the seller's full negotiation range
// Only the "worst case" starting point is exposed for negotiable deals
const NEGOTIABLE_SENSITIVE_FIELDS = [
  "maxDiscountBps", // Best discount - hidden
  "minLockupDays", // Best lockup - hidden
  "minDealAmount",
  "maxDealAmount",
  "allowedBuyers",
] as const;

export type SanitizedConsignment = Omit<
  OTCConsignment,
  (typeof NEGOTIABLE_SENSITIVE_FIELDS)[number]
> & {
  termsType: "negotiable" | "fixed";
  // For negotiable: starting point (worst deal for buyer)
  // For fixed: the actual fixed terms
  displayDiscountBps: number;
  displayLockupDays: number;
};

/**
 * Sanitize consignment to hide negotiation terms from non-owners.
 * 
 * For NEGOTIABLE deals: Shows "starting at" the worst possible deal
 *   - displayDiscountBps = minDiscountBps (lowest discount)
 *   - displayLockupDays = maxLockupDays (longest lockup)
 * 
 * For FIXED deals: Shows the actual fixed terms
 *   - displayDiscountBps = fixedDiscountBps
 *   - displayLockupDays = fixedLockupDays
 * 
 * This prevents buyers from gaming negotiations while still showing useful info.
 */
export function sanitizeConsignmentForBuyer(
  consignment: OTCConsignment,
): SanitizedConsignment {
  const sanitized: Record<string, unknown> = { ...consignment };

  // Remove sensitive fields that reveal negotiation range
  for (const field of NEGOTIABLE_SENSITIVE_FIELDS) {
    delete sanitized[field];
  }

  // Set display terms based on deal type
  if (consignment.isNegotiable) {
    // Show worst case: min discount, max lockup ("starting at")
    sanitized.displayDiscountBps = consignment.minDiscountBps ?? 0;
    sanitized.displayLockupDays = consignment.maxLockupDays ?? 0;
    // Remove actual ranges - only show starting point
    delete sanitized.minDiscountBps;
    delete sanitized.maxLockupDays;
    delete sanitized.fixedDiscountBps;
    delete sanitized.fixedLockupDays;
  } else {
    // Fixed deal - show actual terms
    sanitized.displayDiscountBps = consignment.fixedDiscountBps ?? 0;
    sanitized.displayLockupDays = consignment.fixedLockupDays ?? 0;
  }

  sanitized.termsType = consignment.isNegotiable ? "negotiable" : "fixed";

  return sanitized as SanitizedConsignment;
}

/**
 * Check if a caller is the owner of a consignment.
 * Handles both Solana (case-sensitive) and EVM (case-insensitive) addresses.
 */
export function isConsignmentOwner(
  consignment: OTCConsignment,
  callerAddress: string | null | undefined,
): boolean {
  if (!callerAddress) return false;

  const normalizedCaller =
    consignment.chain === "solana"
      ? callerAddress
      : callerAddress.toLowerCase();
  const normalizedConsigner =
    consignment.chain === "solana"
      ? consignment.consignerAddress
      : consignment.consignerAddress.toLowerCase();

  return normalizedCaller === normalizedConsigner;
}
