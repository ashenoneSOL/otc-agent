/**
 * Core Database Types
 * These are the base interfaces for database entities.
 * Separated to avoid circular dependencies with validation schemas.
 */

import type { Chain } from "../config/chains";

//==============================================================================
// DATABASE TYPES
//==============================================================================

/**
 * Token in database
 */
export interface Token {
  id: string;
  symbol: string;
  name: string;
  contractAddress: string;
  chain: Chain;
  decimals: number;
  logoUrl: string;
  description: string;
  website?: string;
  twitter?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  // Pool address used for price feeds - stored at registration time to avoid re-searching
  poolAddress?: string;
  // For Solana PumpSwap pools, also store vault addresses
  solVault?: string;
  tokenVault?: string;
}

/**
 * Token market data
 */
export interface TokenMarketData {
  tokenId: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  liquidity: number;
  lastUpdated: number;
}

/**
 * OTC Consignment in database
 */
export interface OTCConsignment {
  id: string;
  tokenId: string;
  consignerAddress: string;
  consignerEntityId: string;
  totalAmount: string;
  remainingAmount: string;
  isNegotiable: boolean;
  fixedDiscountBps?: number;
  fixedLockupDays?: number;
  minDiscountBps: number;
  maxDiscountBps: number;
  minLockupDays: number;
  maxLockupDays: number;
  minDealAmount: string;
  maxDealAmount: string;
  isFractionalized: boolean;
  isPrivate: boolean;
  allowedBuyers?: string[];
  maxPriceVolatilityBps: number;
  maxTimeToExecuteSeconds: number;
  status: "active" | "paused" | "depleted" | "withdrawn";
  contractConsignmentId?: string;
  chain: Chain;
  createdAt: number;
  updatedAt: number;
  lastDealAt?: number;
}

/**
 * Consignment deal record
 */
export interface ConsignmentDeal {
  id: string;
  consignmentId: string;
  quoteId: string;
  tokenId: string;
  buyerAddress: string;
  amount: string;
  discountBps: number;
  lockupDays: number;
  executedAt: number;
  offerId?: string;
  status: "pending" | "executed" | "failed";
}

//==============================================================================
// USER SESSION TYPES
//==============================================================================

/**
 * User session memory
 */
export interface UserSessionMemory {
  id: string;
  entityId: string;
  walletAddress: string;
  chainFamily: "evm" | "solana";
  preferredChain?: string;
  lastActiveAt: number;
  sessionData?: Record<string, string | number | boolean>;
  createdAt: number;
  updatedAt: number;
}
