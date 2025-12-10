import type { Address } from "viem";
import type { Chain } from "@/config/chains";
import type { PaymentCurrency } from "@/lib/plugin-otc-desk/types";

export type { ChatMessage } from "./chat-message";
export type { Citation, ChatStreamData } from "./chat";

export type {
  PaymentCurrency,
  QuoteStatus,
  QuoteMemory,
  UserSessionMemory as PluginUserSessionMemory,
} from "@/lib/plugin-otc-desk/types";

export type EVMChain = "base" | "bsc" | "jeju" | "ethereum";
export type { Chain, ChainConfig } from "@/config/chains";
export {
  SUPPORTED_CHAINS,
  getChainConfig,
  getChainFromId,
  getChainFromNumericId,
} from "@/config/chains";

export interface Offer {
  consignmentId: bigint;
  tokenId: string;
  beneficiary: Address;
  tokenAmount: bigint;
  discountBps: bigint;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  maxPriceDeviation: bigint;
  ethUsdPrice: bigint;
  currency: number;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: Address;
  amountPaid: bigint;
}

export interface ConsignmentParams {
  tokenId: string;
  tokenSymbol: string;
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
}

export interface OTCQuote {
  quoteId: string;
  tokenSymbol: string;
  tokenAmount: number;
  tokenChain: string;
  discountBps: number;
  discountPercent: number;
  lockupDays: number;
  lockupMonths: number;
  paymentCurrency: PaymentCurrency;
  apr: number;
  totalUsd: number;
  discountedUsd: number;
  paymentAmount: string;
  signature?: string;
  isFixedPrice?: boolean;
}

export interface QuoteAccepted {
  quoteId: string;
  txHash: string;
}

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
}

export interface TokenMarketData {
  tokenId: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  liquidity: number;
  lastUpdated: number;
}

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

export interface UserSessionMemory {
  id: string;
  entityId: string;
  walletAddress: string;
  preferredChain?: string;
  lastActiveAt: number;
  sessionData?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TokenWithBalance extends Token {
  balance: string;
  balanceFormatted: string;
  balanceUsd: number;
  priceUsd: number;
}

export interface ConsignmentCreationResult {
  txHash: `0x${string}`;
  consignmentId: bigint;
}
