"use client";

import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { useMultiWallet } from "@/components/multiwallet";
import { usePrivy } from "@privy-io/react-auth";
import { OTCAbiJson as otcArtifact } from "@jeju/contracts/abis";
import { useOTC } from "@/hooks/contracts/useOTC";
import type { OTCQuote } from "@/utils/xml-parser";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Abi } from "viem";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { useAccount, useBalance } from "wagmi";
import { useTransactionErrorHandler } from "@/hooks/useTransactionErrorHandler";
import { getCurrentNetwork } from "@/config/contracts";

interface AcceptQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuote?: Partial<OTCQuote> | null;
  onComplete?: (data: { offerId: bigint; txHash?: `0x${string}` }) => void;
}

type StepState =
  | "amount"
  | "sign"
  | "creating"
  | "await_approval"
  | "paying"
  | "complete";

const ONE_MILLION = 1_000_000;
const MIN_TOKENS = 100;

interface TokenMetadata {
  symbol: string;
  name: string;
  logoUrl: string;
  contractAddress: string;
}

const tokenMetadataCache = new Map<string, TokenMetadata>();

function getCachedTokenMetadata(
  chain: string,
  symbol: string,
): TokenMetadata | null {
  const key = `${chain}:${symbol.toUpperCase()}`;
  return tokenMetadataCache.get(key) || null;
}

function setCachedTokenMetadata(
  chain: string,
  symbol: string,
  metadata: TokenMetadata,
): void {
  const key = `${chain}:${symbol.toUpperCase()}`;
  tokenMetadataCache.set(key, metadata);
  try {
    sessionStorage.setItem(`token-meta:${key}`, JSON.stringify(metadata));
  } catch {
    /* ignore */
  }
}

function loadCachedTokenMetadata(
  chain: string,
  symbol: string,
): TokenMetadata | null {
  const cached = getCachedTokenMetadata(chain, symbol);
  if (cached) return cached;
  try {
    const key = `${chain}:${symbol.toUpperCase()}`;
    const stored = sessionStorage.getItem(`token-meta:${key}`);
    if (stored) {
      const metadata = JSON.parse(stored) as TokenMetadata;
      tokenMetadataCache.set(key, metadata);
      return metadata;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const CONTRACT_CACHE_TTL_MS = 5 * 60 * 1000;
interface ContractCacheEntry {
  exists: boolean;
  cachedAt: number;
}
const contractExistsCache = new Map<string, ContractCacheEntry>();

function getContractExists(key: string): boolean | null {
  const entry = contractExistsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= CONTRACT_CACHE_TTL_MS) {
    contractExistsCache.delete(key);
    return null;
  }
  return entry.exists;
}

function setContractExists(key: string, exists: boolean): void {
  contractExistsCache.set(key, { exists, cachedAt: Date.now() });
}

interface ModalState {
  tokenAmount: number;
  currency: "ETH" | "USDC";
  step: StepState;
  isProcessing: boolean;
  error: string | null;
  requireApprover: boolean;
  contractValid: boolean;
  tokenMetadata: TokenMetadata | null;
  completedTxHash: string | null;
  completedOfferId: string | null;
}

type ModalAction =
  | { type: "SET_TOKEN_AMOUNT"; payload: number }
  | { type: "SET_CURRENCY"; payload: "ETH" | "USDC" }
  | { type: "SET_STEP"; payload: StepState }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_REQUIRE_APPROVER"; payload: boolean }
  | { type: "SET_CONTRACT_VALID"; payload: boolean }
  | { type: "SET_TOKEN_METADATA"; payload: TokenMetadata | null }
  | {
      type: "SET_COMPLETED";
      payload: { txHash: string | null; offerId: string };
    }
  | {
      type: "RESET";
      payload: { tokenAmount: number; currency: "ETH" | "USDC" };
    }
  | { type: "START_TRANSACTION" }
  | { type: "TRANSACTION_ERROR"; payload: string };

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case "SET_TOKEN_AMOUNT":
      return { ...state, tokenAmount: action.payload };
    case "SET_CURRENCY":
      return { ...state, currency: action.payload };
    case "SET_STEP":
      return { ...state, step: action.payload };
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_REQUIRE_APPROVER":
      return { ...state, requireApprover: action.payload };
    case "SET_CONTRACT_VALID":
      return { ...state, contractValid: action.payload };
    case "SET_TOKEN_METADATA":
      return { ...state, tokenMetadata: action.payload };
    case "SET_COMPLETED":
      return {
        ...state,
        step: "complete",
        isProcessing: false,
        completedTxHash: action.payload.txHash,
        completedOfferId: action.payload.offerId,
      };
    case "RESET":
      return {
        ...state,
        step: "amount",
        isProcessing: false,
        error: null,
        tokenAmount: action.payload.tokenAmount,
        currency: action.payload.currency,
        tokenMetadata: null,
        completedTxHash: null,
        completedOfferId: null,
      };
    case "START_TRANSACTION":
      return { ...state, error: null, isProcessing: true, step: "creating" };
    case "TRANSACTION_ERROR":
      return {
        ...state,
        error: action.payload,
        isProcessing: false,
        step: "amount",
      };
    default:
      return state;
  }
}

export function AcceptQuoteModal({
  isOpen,
  onClose,
  initialQuote,
  onComplete,
}: AcceptQuoteModalProps) {
  const { isConnected, address } = useAccount();
  const {
    isConnected: walletConnected,
    privyAuthenticated,
    connectWallet,
  } = useMultiWallet();

  const router = useRouter();
  const {
    otcAddress,
    createOffer,
    defaultUnlockDelaySeconds,
    usdcAddress,
    maxTokenPerOrder,
  } = useOTC();

  const abi = useMemo(() => otcArtifact.abi as Abi, []);

  const networkEnv = getCurrentNetwork();
  const isMainnet = networkEnv === "mainnet";
  const isLocal = networkEnv === "local";

  const rpcUrl = useMemo(() => {
    if (isLocal) {
      return process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
    }
    if (process.env.NEXT_PUBLIC_BASE_RPC_URL) {
      return process.env.NEXT_PUBLIC_BASE_RPC_URL;
    }
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/rpc/base`;
    }
    return isMainnet ? "https://mainnet.base.org" : "https://sepolia.base.org";
  }, [isLocal, isMainnet]);

  const isLocalRpc = useMemo(
    () => /localhost|127\.0\.0\.1/.test(rpcUrl),
    [rpcUrl],
  );

  const readChain = useMemo(() => {
    if (isLocalRpc) {
      return {
        id: 31337,
        name: "Localhost",
        network: "localhost",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      };
    }
    return isMainnet ? base : baseSepolia;
  }, [isLocalRpc, rpcUrl, isMainnet]);

  const publicClient = useMemo(
    () => createPublicClient({ chain: readChain, transport: http(rpcUrl) }),
    [readChain, rpcUrl],
  );

  const initialState: ModalState = {
    tokenAmount: Math.min(
      ONE_MILLION,
      Math.max(
        MIN_TOKENS,
        initialQuote?.tokenAmount ? Number(initialQuote.tokenAmount) : 1000,
      ),
    ),
    currency: "ETH",
    step: "amount",
    isProcessing: false,
    error: null,
    requireApprover: false,
    contractValid: false,
    tokenMetadata: null,
    completedTxHash: null,
    completedOfferId: null,
  };

  const [state, dispatch] = useReducer(modalReducer, initialState);
  const {
    tokenAmount,
    currency,
    step,
    isProcessing,
    error,
    requireApprover,
    contractValid,
    tokenMetadata,
    completedTxHash,
  } = state;

  const { handleTransactionError } = useTransactionErrorHandler();
  const { login, ready: privyReady } = usePrivy();

  const ethBalance = useBalance({ address });
  const usdcBalance = useBalance({
    address,
    token: usdcAddress as `0x${string}` | undefined,
  });

  useEffect(() => {
    if (!isOpen) {
      dispatch({
        type: "RESET",
        payload: {
          tokenAmount: Math.min(
            ONE_MILLION,
            Math.max(
              MIN_TOKENS,
              initialQuote?.tokenAmount
                ? Number(initialQuote.tokenAmount)
                : 1000,
            ),
          ),
          currency: "ETH",
        },
      });
    }
  }, [isOpen, initialQuote]);

  useEffect(() => {
    if (!isOpen || !initialQuote?.tokenSymbol) return;

    const chain = initialQuote?.tokenChain || "base";
    const symbol = initialQuote.tokenSymbol;

    const cached = loadCachedTokenMetadata(chain, symbol);
    if (cached) {
      dispatch({ type: "SET_TOKEN_METADATA", payload: cached });
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/tokens?chain=${chain}`);
        const data = await res.json();
        if (data.success && data.tokens) {
          const token = data.tokens.find(
            (t: TokenMetadata) => t.symbol.toUpperCase() === symbol.toUpperCase(),
          );
          if (token) {
            const metadata: TokenMetadata = {
              symbol: token.symbol,
              name: token.name,
              logoUrl: token.logoUrl || "",
              contractAddress: token.contractAddress,
            };
            setCachedTokenMetadata(chain, symbol, metadata);
            dispatch({ type: "SET_TOKEN_METADATA", payload: metadata });
          }
        }
      } catch (err) {
        console.error("[AcceptQuote] Failed to look up token:", err);
      }
    })();
  }, [isOpen, initialQuote?.tokenSymbol, initialQuote?.tokenChain]);

  useEffect(() => {
    (async () => {
      if (!isOpen || !otcAddress) {
        dispatch({ type: "SET_CONTRACT_VALID", payload: false });
        return;
      }

      const cacheKey = `${otcAddress}:${readChain.id}`;
      const cachedExists = getContractExists(cacheKey);
      if (cachedExists !== null) {
        dispatch({ type: "SET_CONTRACT_VALID", payload: cachedExists });
        if (!cachedExists) {
          dispatch({
            type: "SET_ERROR",
            payload:
              "Contract not found. Ensure the node is running and contracts are deployed.",
          });
        }
        return;
      }

      const code = await publicClient.getBytecode({
        address: otcAddress as `0x${string}`,
      });

      const exists = Boolean(code && code !== "0x");
      setContractExists(cacheKey, exists);

      if (!exists) {
        dispatch({ type: "SET_CONTRACT_VALID", payload: false });
        dispatch({
          type: "SET_ERROR",
          payload:
            "Contract not found. Ensure the node is running and contracts are deployed.",
        });
        return;
      }

      dispatch({ type: "SET_CONTRACT_VALID", payload: true });

      const readContract = publicClient.readContract as (
        params: unknown,
      ) => Promise<unknown>;
      const flag = (await readContract({
        address: otcAddress as `0x${string}`,
        abi: abi as Abi,
        functionName: "requireApproverToFulfill",
        args: [],
      })) as boolean;
      dispatch({ type: "SET_REQUIRE_APPROVER", payload: Boolean(flag) });
    })();
  }, [isOpen, otcAddress, publicClient, abi, readChain]);

  const discountBps = useMemo(() => {
    const fromQuote = initialQuote?.discountBps;
    if (typeof fromQuote === "number" && !Number.isNaN(fromQuote)) {
      return fromQuote;
    }
    return 100;
  }, [initialQuote?.discountBps]);

  const lockupDays = useMemo(() => {
    if (typeof initialQuote?.lockupDays === "number")
      return initialQuote.lockupDays;
    if (typeof initialQuote?.lockupMonths === "number")
      return Math.max(1, initialQuote.lockupMonths * 30);
    return Number(
      defaultUnlockDelaySeconds ? defaultUnlockDelaySeconds / 86400n : 180n,
    );
  }, [
    initialQuote?.lockupDays,
    initialQuote?.lockupMonths,
    defaultUnlockDelaySeconds,
  ]);

  const contractMaxTokens = useMemo(() => {
    const v = maxTokenPerOrder
      ? Number(maxTokenPerOrder / 10n ** 18n)
      : ONE_MILLION;
    return Math.max(MIN_TOKENS, Math.min(ONE_MILLION, v));
  }, [maxTokenPerOrder]);

  const clampAmount = useCallback(
    (value: number) =>
      Math.min(contractMaxTokens, Math.max(MIN_TOKENS, Math.floor(value))),
    [contractMaxTokens],
  );

  const setTokenAmount = useCallback(
    (value: number) => {
      dispatch({ type: "SET_TOKEN_AMOUNT", payload: clampAmount(value) });
    },
    [clampAmount],
  );

  const setCurrency = useCallback((value: "ETH" | "USDC") => {
    dispatch({ type: "SET_CURRENCY", payload: value });
  }, []);

  async function readNextOfferId(): Promise<bigint> {
    if (!otcAddress) throw new Error("Missing OTC address");
    const readContract = publicClient.readContract as (
      params: unknown,
    ) => Promise<unknown>;
    return (await readContract({
      address: otcAddress as `0x${string}`,
      abi: abi as Abi,
      functionName: "nextOfferId",
      args: [],
    })) as bigint;
  }

  type OfferTuple = readonly [
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    number,
    boolean,
    boolean,
    boolean,
    boolean,
    `0x${string}`,
    bigint,
  ];

  async function readOffer(offerId: bigint): Promise<OfferTuple> {
    if (!otcAddress) throw new Error("Missing OTC address");
    const readContract = publicClient.readContract as (
      params: unknown,
    ) => Promise<unknown>;
    return (await readContract({
      address: otcAddress as `0x${string}`,
      abi: abi as Abi,
      functionName: "offers",
      args: [offerId],
    })) as OfferTuple;
  }

  const handleConfirm = useCallback(async () => {
    if (!walletConnected) return;

    if (!initialQuote?.quoteId) {
      dispatch({
        type: "SET_ERROR",
        payload:
          "No quote ID available. Please request a quote from the chat first.",
      });
      return;
    }

    if (!contractValid) {
      dispatch({
        type: "SET_ERROR",
        payload:
          "Contract not available. Please ensure the node is running and contracts are deployed.",
      });
      return;
    }

    dispatch({ type: "START_TRANSACTION" });

    try {
      await executeTransaction();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const txError = {
        ...error,
        message: error.message,
        cause: error.cause as
          | { reason?: string; code?: string | number }
          | undefined,
        details: (error as { details?: string }).details,
        shortMessage: (error as { shortMessage?: string }).shortMessage,
      };
      const errorMessage = handleTransactionError(txError);
      dispatch({ type: "TRANSACTION_ERROR", payload: errorMessage });
    }
  }, [
    walletConnected,
    initialQuote?.quoteId,
    contractValid,
    handleTransactionError,
  ]);

  const executeTransaction = async () => {
    if (
      initialQuote?.beneficiary &&
      address &&
      initialQuote.beneficiary.toLowerCase() !== address.toLowerCase()
    ) {
      throw new Error(
        `Wallet mismatch: Quote is for ${initialQuote.beneficiary.slice(0, 6)}... but you're connected as ${address.slice(0, 6)}...`,
      );
    }

    const [nextId] = await Promise.all([
      readNextOfferId(),
      initialQuote?.quoteId
        ? fetch("/api/quote/latest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quoteId: initialQuote.quoteId,
              beneficiary: address,
              tokenAmount: String(tokenAmount),
              paymentCurrency: currency,
              totalUsd: 0,
              discountUsd: 0,
              discountedUsd: 0,
              paymentAmount: "0",
            }),
          }).catch(() => {})
        : Promise.resolve(),
    ]);
    const newOfferId = nextId;

    const tokenAmountWei = BigInt(tokenAmount) * 10n ** 18n;
    const lockupSeconds = BigInt(lockupDays * 24 * 60 * 60);
    const paymentCurrency = currency === "ETH" ? 0 : 1;

    const createTxHash = (await createOffer({
      tokenAmountWei,
      discountBps,
      paymentCurrency,
      lockupSeconds,
    })) as `0x${string}`;

    dispatch({ type: "SET_STEP", payload: "await_approval" });

    await new Promise((resolve) => setTimeout(resolve, 100));

    let approveRes;
    let lastApproveError: unknown;
    const maxApproveAttempts = 5;

    for (let attempt = 1; attempt <= maxApproveAttempts; attempt++) {
      try {
        approveRes = await fetch("/api/otc/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offerId: newOfferId.toString(),
            txHash: createTxHash,
          }),
        });

        if (approveRes.ok) break;
        if (approveRes.status >= 400 && approveRes.status < 500) break;

        lastApproveError = `HTTP ${approveRes.status}`;
      } catch (fetchError) {
        lastApproveError = fetchError;
      }

      if (attempt < maxApproveAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (!approveRes) {
      throw new Error(
        `Network error calling approval API: ${lastApproveError}`,
      );
    }

    if (!approveRes.ok) {
      const errorText = await approveRes.text();
      throw new Error(`Approval failed: ${errorText}`);
    }

    const approveData = await approveRes.json();

    if (!approveData.autoFulfilled || !approveData.fulfillTx) {
      if (!requireApprover) {
        throw new Error(
          "Contract is not configured for auto-fulfillment. Please contact support.",
        );
      }

      const [, , , , , , , , , isPaid] = await readOffer(newOfferId);
      if (!isPaid) {
        throw new Error(
          `Backend approval succeeded but payment failed. Your offer (ID: ${newOfferId}) is approved but not paid. Please contact support.`,
        );
      }
    }

    const paymentTxHash = (approveData.fulfillTx ||
      approveData.approvalTx) as `0x${string}`;

    const [, , , , , , , , , isPaidFinal] = await readOffer(newOfferId);

    if (!isPaidFinal) {
      throw new Error(
        "Backend reported success but offer not paid on-chain. Please contact support with offer ID: " +
          newOfferId,
      );
    }

    if (!initialQuote?.quoteId) {
      throw new Error("Missing quote ID - cannot save deal completion");
    }

    const saveRes = await fetch("/api/deal-completion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        quoteId: initialQuote.quoteId,
        tokenAmount: String(tokenAmount),
        paymentCurrency: currency,
        offerId: String(newOfferId),
        transactionHash: paymentTxHash,
        chain: "evm",
      }),
    });

    if (!saveRes.ok) {
      const errorText = await saveRes.text();
      throw new Error(
        `Deal completion save failed: ${errorText}. Offer ID: ${newOfferId}`,
      );
    }

    dispatch({
      type: "SET_COMPLETED",
      payload: {
        txHash: paymentTxHash,
        offerId: newOfferId.toString(),
      },
    });

    onComplete?.({ offerId: newOfferId, txHash: paymentTxHash });

    setTimeout(() => {
      router.push(`/deal/${initialQuote.quoteId}`);
    }, 2000);
  };

  const estPerTokenUsd = useMemo(() => {
    const basePrice = initialQuote?.pricePerToken || 0;
    if (basePrice <= 0) return 0;
    const discountBps = initialQuote?.discountBps || 0;
    const discountMultiplier = 1 - discountBps / 10000;
    return basePrice * discountMultiplier;
  }, [initialQuote?.pricePerToken, initialQuote?.discountBps]);

  const balanceDisplay = useMemo(() => {
    if (!isConnected) return "—";
    if (currency === "USDC") {
      const v = Number(usdcBalance.data?.formatted || 0);
      return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    const eth = Number(ethBalance.data?.formatted || 0);
    return `${eth.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  }, [
    isConnected,
    currency,
    usdcBalance.data?.formatted,
    ethBalance.data?.formatted,
  ]);

  const handleMaxClick = () => {
    let maxByFunds = MIN_TOKENS;
    if (currency === "USDC") {
      const usdc = Number(usdcBalance.data?.formatted || 0);
      if (estPerTokenUsd > 0) {
        maxByFunds = Math.floor(usdc / estPerTokenUsd);
      }
    } else {
      const eth = Number(ethBalance.data?.formatted || 0);
      const ethUsd = initialQuote?.ethPrice || 0;
      if (ethUsd > 0 && estPerTokenUsd > 0) {
        const usd = eth * ethUsd;
        maxByFunds = Math.floor(usd / estPerTokenUsd);
      }
    }
    if (maxByFunds < MIN_TOKENS) {
      maxByFunds = MIN_TOKENS;
    }
    setTokenAmount(clampAmount(maxByFunds));
  };

  const handleConnect = () => {
    if (privyAuthenticated) {
      connectWallet();
    } else {
      login();
    }
  };

  const maxAffordableTokens = useMemo(() => {
    if (estPerTokenUsd <= 0) return ONE_MILLION;
    if (currency === "USDC") {
      const usdc = Number(usdcBalance.data?.formatted || 0);
      return Math.floor(usdc / estPerTokenUsd);
    } else {
      const eth = Number(ethBalance.data?.formatted || 0);
      const ethUsd = initialQuote?.ethPrice || 0;
      if (ethUsd > 0) {
        const usd = eth * ethUsd;
        return Math.floor(usd / estPerTokenUsd);
      }
    }
    return ONE_MILLION;
  }, [
    estPerTokenUsd,
    currency,
    usdcBalance.data?.formatted,
    ethBalance.data?.formatted,
    initialQuote?.ethPrice,
  ]);

  const validationError = useMemo(() => {
    if (tokenAmount < MIN_TOKENS) {
      return `Order too small. Minimum is ${MIN_TOKENS.toLocaleString()} tokens.`;
    }
    if (tokenAmount > contractMaxTokens) {
      return `Amount exceeds maximum of ${contractMaxTokens.toLocaleString()} tokens.`;
    }
    if (estPerTokenUsd > 0 && tokenAmount > maxAffordableTokens) {
      return `Amount exceeds what you can afford (~${maxAffordableTokens.toLocaleString()} tokens max).`;
    }
    return null;
  }, [tokenAmount, contractMaxTokens, estPerTokenUsd, maxAffordableTokens]);

  const estimatedPayment = useMemo(() => {
    if (estPerTokenUsd <= 0)
      return { usdc: undefined, eth: undefined };
    const totalUsd = tokenAmount * estPerTokenUsd;
    if (currency === "USDC") {
      return { usdc: totalUsd.toFixed(2), eth: undefined };
    } else {
      const ethUsd = initialQuote?.ethPrice || 0;
      if (ethUsd > 0) {
        return {
          usdc: undefined,
          eth: (totalUsd / ethUsd).toFixed(6),
        };
      }
    }
    return { usdc: undefined, eth: undefined };
  }, [tokenAmount, estPerTokenUsd, currency, initialQuote?.ethPrice]);

  const insufficientFunds = useMemo(() => {
    if (estPerTokenUsd <= 0) return false;
    return tokenAmount > maxAffordableTokens;
  }, [estPerTokenUsd, tokenAmount, maxAffordableTokens]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="3xl"
      data-testid="accept-quote-modal"
    >
      <div className="w-full max-w-[720px] mx-auto p-0 rounded-2xl bg-zinc-950 text-white ring-1 ring-white/10 max-h-[95dvh] overflow-y-auto">
        <div className="flex items-center justify-between px-3 sm:px-5 pt-4 sm:pt-5">
          <div className="text-base sm:text-lg font-semibold tracking-wide">
            Your Quote
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
            <button
              type="button"
              className={`px-2 py-1 rounded-md ${currency === "USDC" ? "bg-white text-black" : "text-zinc-300"}`}
              onClick={() => setCurrency("USDC")}
            >
              USDC
            </button>
            <span className="text-zinc-600">|</span>
            <button
              type="button"
              className={`px-2 py-1 rounded-md ${currency === "ETH" ? "bg-white text-black" : "text-zinc-300"}`}
              onClick={() => setCurrency("ETH")}
            >
              ETH
            </button>
          </div>
        </div>

        <div className="m-3 sm:m-5 rounded-xl bg-zinc-900 ring-1 ring-white/10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-5 pt-3 sm:pt-4 gap-2">
            <div className="text-xs sm:text-sm text-zinc-400">
              Amount to Buy
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-zinc-400">
              <span className="whitespace-nowrap">
                Balance: {balanceDisplay}
              </span>
              <button
                type="button"
                className="text-brand-400 hover:text-brand-300 font-medium"
                onClick={handleMaxClick}
              >
                MAX
              </button>
            </div>
          </div>
          <div className="px-3 sm:px-5 pb-2">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              <input
                data-testid="token-amount-input"
                type="number"
                value={tokenAmount}
                onChange={(e) =>
                  setTokenAmount(clampAmount(Number(e.target.value)))
                }
                min={MIN_TOKENS}
                max={ONE_MILLION}
                className="w-full bg-transparent border-none outline-none text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white"
              />
              <div className="flex items-center gap-3 text-right flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden ring-1 ring-white/10">
                  {tokenMetadata?.logoUrl ? (
                    <img
                      src={tokenMetadata.logoUrl}
                      alt={tokenMetadata.symbol}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.parentElement!.innerHTML = `<span class="text-brand-400 text-sm font-bold">${tokenMetadata?.symbol?.slice(0, 2) || "₣"}</span>`;
                      }}
                    />
                  ) : (
                    <span className="text-brand-400 text-sm font-bold">
                      {initialQuote?.tokenSymbol?.slice(0, 2) || "₣"}
                    </span>
                  )}
                </div>
                <div className="text-right min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {tokenMetadata?.symbol ||
                      initialQuote?.tokenSymbol ||
                      "TOKEN"}
                  </div>
                  <div className="text-xs text-zinc-400 truncate max-w-[120px]">
                    {tokenMetadata?.name || "Token"}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-2">
              <input
                data-testid="token-amount-slider"
                type="range"
                min={MIN_TOKENS}
                max={ONE_MILLION}
                value={tokenAmount}
                onChange={(e) =>
                  setTokenAmount(clampAmount(Number(e.target.value)))
                }
                className="w-full accent-brand-500"
              />
            </div>
          </div>
        </div>

        <div className="px-3 sm:px-5 pb-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 text-xs sm:text-sm">
            <div>
              <div className="text-zinc-500 text-xs">Your Discount</div>
              <div className="text-base sm:text-lg font-semibold">
                {(discountBps / 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs">Maturity</div>
              <div className="text-base sm:text-lg font-semibold">
                {Math.round(lockupDays / 30)} mo
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs">Maturity date</div>
              <div className="text-base sm:text-lg font-semibold">
                {new Date(
                  Date.now() + lockupDays * 24 * 60 * 60 * 1000,
                ).toLocaleDateString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                  year: "2-digit",
                })}
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-xs">Est. Payment</div>
              <div className="text-base sm:text-lg font-semibold">
                {currency === "USDC" && estimatedPayment.usdc
                  ? `$${Number(estimatedPayment.usdc).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : currency === "ETH" && estimatedPayment.eth
                    ? `${estimatedPayment.eth} ETH`
                    : "—"}
              </div>
            </div>
          </div>
        </div>

        {requireApprover && (
          <div className="px-3 sm:px-5 pb-1 text-xs text-zinc-400">
            Payment will be executed by the desk&apos;s whitelisted approver
            wallet on your behalf after approval.
          </div>
        )}

        {(error || validationError || insufficientFunds) && (
          <div className="px-3 sm:px-5 pt-2 text-xs text-red-400">
            {error ||
              validationError ||
              (insufficientFunds
                ? `Insufficient ${currency} balance for this purchase.`
                : null)}
          </div>
        )}

        {!walletConnected ? (
          <div className="px-3 sm:px-5 pb-4 sm:pb-5">
            <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-zinc-900">
              <div className="relative">
                <div className="relative min-h-[200px] sm:min-h-[280px] w-full bg-gradient-to-br from-zinc-900 to-zinc-800 py-6 sm:py-8">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-30 bg-no-repeat bg-right-bottom"
                    style={{
                      backgroundImage: "url('/business.png')",
                      backgroundSize: "contain",
                    }}
                  />
                  <div className="relative z-10 h-full w-full flex flex-col items-center justify-center text-center px-4 sm:px-6">
                    <h3 className="text-lg sm:text-xl font-semibold text-white tracking-tight mb-2">
                      Sign in to continue
                    </h3>
                    <p className="text-zinc-300 text-sm sm:text-md mb-4">
                      Let&apos;s deal, anon.
                    </p>
                    <Button
                      onClick={handleConnect}
                      disabled={!privyReady}
                      color="brand"
                      className="!px-6 sm:!px-8 !py-2 sm:!py-3 !text-base sm:!text-lg"
                    >
                      {privyReady ? "Connect Wallet" : "Loading..."}
                    </Button>
                    <p className="text-xs text-zinc-500 mt-3 sm:mt-4">
                      Supports Farcaster, MetaMask, Coinbase Wallet & more
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 sm:gap-3 mt-3 sm:mt-4">
              <Button onClick={onClose} color="dark">
                <div className="px-3 sm:px-4 py-2">Cancel</div>
              </Button>
            </div>
          </div>
        ) : step !== "complete" ? (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 px-3 sm:px-5 py-4 sm:py-5">
            <Button
              onClick={onClose}
              color="dark"
              className="w-full sm:w-auto"
            >
              <div className="px-4 py-2">Cancel</div>
            </Button>
            <Button
              data-testid="confirm-amount-button"
              onClick={handleConfirm}
              color="brand"
              className="w-full sm:w-auto"
              disabled={
                Boolean(validationError) ||
                insufficientFunds ||
                isProcessing
              }
            >
              <div className="px-4 py-2">Buy Now</div>
            </Button>
          </div>
        ) : null}

        {step === "creating" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mx-auto mb-4"></div>
              <h3 className="font-semibold mb-2">Creating Offer</h3>
              <p className="text-sm text-zinc-400">
                Confirm the transaction in your wallet to create your offer
                on-chain.
              </p>
            </div>
          </div>
        )}

        {step === "await_approval" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
              <h3 className="font-semibold mb-2">Processing Deal</h3>
              <p className="text-sm text-zinc-400">
                Our desk is reviewing and completing your purchase. Payment
                will be processed automatically.
              </p>
              <p className="text-xs text-zinc-500 mt-2">
                This usually takes a few seconds...
              </p>
            </div>
          </div>
        )}

        {step === "paying" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <h3 className="font-semibold mb-2">Completing Payment</h3>
              <p className="text-sm text-zinc-400">
                Finalizing your purchase on-chain...
              </p>
            </div>
          </div>
        )}

        {step === "complete" && (
          <div className="px-5 pb-6">
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="font-semibold mb-2">Deal Complete</h3>
              <p className="text-sm text-zinc-400">
                Your purchase is complete. You&apos;ll receive your tokens at
                maturity.
              </p>
              {completedTxHash && (
                <a
                  href={`https://basescan.org/tx/${completedTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 mt-3"
                >
                  View transaction ↗
                </a>
              )}
              <p className="text-xs text-zinc-500 mt-3">
                Redirecting to your deal page...
              </p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
