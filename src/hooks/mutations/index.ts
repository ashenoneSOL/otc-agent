/**
 * Mutation Hooks Index
 *
 * Re-exports all mutation hooks for easy import
 */

export {
  useCreateConsignment,
  useSolanaWithdrawConsignment,
  useUpdateConsignment,
  useWithdrawConsignment,
} from "./useConsignmentMutations";

// Types
export type { WalletAuthHeaders } from "./useConsignmentMutations";

export {
  useApproveOffer,
  useClaimTokens,
  useCompleteDeal,
  useShareDeal,
  useUpdateQuote,
} from "./useDealMutations";
