export type QuoteStatus =
  | "active"
  | "expired"
  | "executed"
  | "rejected"
  | "approved";
export type PaymentCurrency = "ETH" | "USDC";

export interface QuoteMemory {
  id: string;
  quoteId: string;
  entityId: string;
  beneficiary: string;
  tokenAmount: string;
  discountBps: number;
  apr: number;
  lockupMonths: number;
  lockupDays: number;
  paymentCurrency: PaymentCurrency;
  priceUsdPerToken: number;
  totalUsd: number;
  discountUsd: number;
  discountedUsd: number;
  paymentAmount: string;
  status: QuoteStatus;
  signature: string;
  createdAt: number;
  executedAt: number;
  rejectedAt: number;
  approvedAt: number;
  offerId: string;
  transactionHash: string;
  blockNumber: number;
  rejectionReason: string;
  approvalNote: string;
  chain?: string;
  tokenId?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenLogoUrl?: string;
  consignmentId?: string;
}

export interface UserSessionMemory {
  id: string;
  entityId: string;
  walletAddress: string;
  quotesCreated: number;
  lastQuoteAt: number;
  dailyQuoteCount: number;
  dailyResetAt: number;
  totalDeals: number;
  totalVolumeUsd: number;
  totalSavedUsd: number;
  createdAt: number;
  updatedAt: number;
}
