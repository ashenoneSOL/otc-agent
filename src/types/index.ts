/**
 * Consolidated Type Definitions
 * Single source of truth for all shared types across the OTC Agent
 */

import type { Address } from "viem";
import type { Chain } from "../config/chains";

// Re-export from plugin types (these use Zod types internally)
export type {
  ChainType,
  EntitySourceMetadata,
  QuoteMemory,
  UserQuoteStats,
} from "../lib/plugin-otc-desk/types";
// Re-export API types (consolidated from API routes)
export type {
  BulkMetadataCache,
  BulkPriceCache,
  CachedPrice,
  CachedTokenMetadata,
  CachedWalletBalances,
  CodexBalanceItem,
  DealFromAPI,
  DealsResponse,
  HeliusAsset,
  MemoryWithTimestamp,
  RouteContext,
  SolanaMetadataCacheEntry,
  SolanaTokenBalance,
  TokenAccount,
  TokenBalance,
} from "./api";
export type { ChatStreamData, Citation } from "./chat";
// Re-export from specific type files
export type { ChatMessage } from "./chat-message";
// Re-export shared types (consolidated duplicates)
export type {
  AnchorConsignmentAccountAccessor,
  AnchorDeskAccountAccessor,
  AnchorProgramAccountAccessor,
  AnchorWallet,
  // Chain reset types
  ChainResetState,
  // EVM event types
  ConsignmentCreatedArgs,
  ConsignmentSnapshot,
  // Consignment types
  ConsignmentWithDisplay,
  // Currency types
  Currency,
  DealType,
  // OTC Contract types
  DeskAccount,
  EnvConfig,
  EvmConfig,
  EvmDeploymentSnapshot,
  EvmPublicClient,
  EvmWalletConfig,
  FiltersState,
  MarkdownBlockProps,
  // Markdown types
  MarkdownOptions,
  MemoizedMarkdownProps,
  MetaMaskFixtures,
  ModalAction,
  ModalState,
  NativePriceSymbol,
  NativePrices,
  // OAuth & Sharing types
  OAuthResponse,
  OfferApprovedArgs,
  OfferCreatedArgs,
  OfferFulfilledArgs,
  OfferSnapshot,
  OfferTuple,
  PendingShare,
  PhantomProvider,
  PhantomSolanaProvider,
  PhantomWindow,
  // Pool check types
  PoolCheckPool,
  PoolCheckResult,
  PriceUpdateResponse,
  PrivySolanaWallet,
  // Chain types (ChainType exported from plugin types above)
  QuoteChain,
  RawRoomMessage,
  // Transaction types
  SolanaCommitment,
  SolanaConfig,
  SolanaConsignmentAccount,
  SolanaConsignmentSnapshot,
  SolanaDeploymentSnapshot,
  SolanaDeskSnapshot,
  SolanaOfferSnapshot,
  SolanaProvider,
  // Solana types
  SolanaTransaction,
  SolanaWalletAdapter,
  SolanaWalletConfig,
  Step,
  StepState,
  // UI State types
  StepStatus,
  StoredCredentials,
  // Test types
  TestEnv,
  TestState,
  TokenMetadata,
  TokenRegistryAccount,
  TransactionError,
  WalletSigner,
  XCredentials,
} from "./shared";
// Re-export Zod-validated types for status/currency (validation schemas)
export type {
  ConsignmentStatus,
  DealStatus,
  PaymentCurrency,
  QuoteStatus,
} from "./validation/schemas";

//==============================================================================
// CHAIN TYPES
//==============================================================================

// Chain types from config/chains.ts (source of truth)
export type { Chain, ChainConfig, ChainFamily } from "../config/chains";
export {
  getChainConfig,
  getChainFromId,
  getChainFromNumericId,
  isEVMChain,
  isSolanaChain,
  SUPPORTED_CHAINS,
} from "../config/chains";
// NetworkType from config/contracts.ts (source of truth)
export type { NetworkType } from "../config/contracts";
// EVMChain re-exported from validation schemas (single source of truth)
export type { EVMChain } from "./validation/schemas";

//==============================================================================
// OTC CONTRACT TYPES
//==============================================================================

/**
 * OTC Offer structure (matches Solidity contract)
 */
export interface Offer {
  consignmentId: bigint;
  tokenId: string; // bytes32 hex string
  beneficiary: Address;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint; // 8 decimals
  maxPriceDeviation: bigint;
  ethUsdPrice: bigint; // 8 decimals
  currency: number; // 0 = ETH, 1 = USDC
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: Address;
  amountPaid: bigint;
  agentCommissionBps?: number; // 0 for P2P, 25-150 for negotiated deals
}

/**
 * Consignment parameters for on-chain creation (uses bigint for contract calls)
 */
export interface OnChainConsignmentParams {
  tokenId: string;
  tokenSymbol: string;
  tokenAddress: string;
  amount: bigint;
  isNegotiable: boolean;
  fixedDiscountBps: number;
  fixedLockupDays: number;
  minDiscountBps: number;
  maxDiscountBps: number;
  minLockupDays: number;
  maxLockupDays: number;
  minDealAmount: bigint;
  maxDealAmount: bigint;
  isFractionalized: boolean;
  isPrivate: boolean;
  maxPriceVolatilityBps: number;
  maxTimeToExecute: number;
  gasDeposit: bigint;
  selectedPoolAddress?: string; // User-selected pool for token registration (EVM only)
}

// Backwards compatibility alias
export type ConsignmentParams = OnChainConsignmentParams;

/**
 * OTC Quote for XML parsing and frontend display
 * Comprehensive type covering all fields used in quote generation and display
 */
export interface OTCQuote {
  quoteId: string;
  beneficiary?: string;
  tokenAmount: string;
  tokenAmountFormatted?: string;
  tokenSymbol: string;
  tokenChain: Chain; // Required - quote must specify chain for wallet compatibility
  // Token contract address (for direct lookup without DB query)
  tokenAddress?: string;
  apr?: number;
  lockupMonths: number;
  lockupDays: number;
  pricePerToken?: number;
  priceUsd?: number;
  totalValueUsd?: number;
  totalUsd?: number;
  discountBps: number;
  discountPercent: number;
  discountUsd?: number;
  finalPriceUsd?: number;
  paymentCurrency: string;
  paymentAmount?: string;
  paymentSymbol?: string;
  ethPrice?: number;
  bnbPrice?: number;
  nativePrice?: number;
  createdAt?: string;
  status?: string;
  message?: string;
  consignmentId?: string;
  signature?: string;
  isFixedPrice?: boolean;
  // Whether the listing allows partial purchases
  isFractionalized?: boolean;
  // Whether the listing terms are negotiable
  isNegotiable?: boolean;
  // Agent commission in basis points (0 for P2P, 25-150 for negotiated)
  agentCommissionBps?: number;
}

/**
 * Quote accepted confirmation with full transaction details
 */
export interface QuoteAccepted {
  quoteId: string;
  offerId: string;
  transactionHash: string;
  tokenAmount: string;
  tokenAmountFormatted: string;
  tokenSymbol: string;
  tokenName: string;
  paidAmount: string;
  paymentCurrency: string;
  discountBps: number;
  discountPercent: number;
  totalSaved: string;
  finalPrice: string;
  status: string;
  timestamp: string;
  message: string;
}

//==============================================================================
// DATABASE TYPES (re-exported from db-types.ts to avoid circular deps)
//==============================================================================

// Import for local use in this file (extends, etc.)
import type { TokenMarketData as TokenMarketDataType, Token as TokenType } from "./db-types";

// Re-export for external consumers
export type {
  ConsignmentDeal,
  OTCConsignment,
  Token,
  TokenMarketData,
  UserSessionMemory,
} from "./db-types";

//==============================================================================
// UTILITY TYPES
//==============================================================================

/**
 * Token with balance information (used for wallet token display)
 */
export interface TokenWithBalance extends TokenType {
  balance: string;
  balanceFormatted?: string; // Optional - human-readable balance
  balanceUsd: number;
  priceUsd: number;
}

/**
 * Alias for TokenWithBalance - used in wallet hooks
 */
export type WalletToken = TokenWithBalance;

/**
 * Token combined with market data
 */
export interface TokenWithMarketData {
  token: TokenType;
  marketData: TokenMarketDataType | null;
}

/**
 * Consignment creation result
 */
export interface ConsignmentCreationResult {
  txHash: `0x${string}`;
  consignmentId: bigint;
}

// Pool check types re-exported from shared.ts
