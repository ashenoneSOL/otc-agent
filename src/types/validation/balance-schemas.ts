/**
 * Zod schemas for balance types
 * Separated from db-schemas.ts to avoid circular dependencies
 */

import { z } from "zod";
import {
  AddressSchema,
  BigIntStringSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  UrlSchema,
} from "./schemas";

//==============================================================================
// BALANCE TOKEN SCHEMAS (used by hooks and API routes)
//==============================================================================

/**
 * EVM token balance structure
 * Single source of truth - used by both API routes and hooks
 */
export const TokenBalanceSchema = z.object({
  contractAddress: AddressSchema,
  symbol: NonEmptyStringSchema,
  name: z.string(),
  decimals: z.number().int().min(0).max(255),
  balance: BigIntStringSchema,
  // logoUrl can be null from external APIs (DeFiLlama, etc.)
  logoUrl: UrlSchema.nullable().optional(),
  priceUsd: NonNegativeNumberSchema.optional(),
  balanceUsd: NonNegativeNumberSchema.optional(),
});
export type TokenBalance = z.infer<typeof TokenBalanceSchema>;

/**
 * Solana token balance structure
 * Single source of truth - used by both API routes and hooks
 */
export const SolanaTokenBalanceSchema = z.object({
  mint: AddressSchema,
  amount: z.number().int().nonnegative(),
  decimals: z.number().int().min(0).max(255),
  symbol: NonEmptyStringSchema,
  name: z.string(),
  logoURI: UrlSchema.nullable(),
  priceUsd: NonNegativeNumberSchema,
  balanceUsd: NonNegativeNumberSchema,
});
export type SolanaTokenBalance = z.infer<typeof SolanaTokenBalanceSchema>;
