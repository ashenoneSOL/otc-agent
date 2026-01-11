import { type NextRequest, NextResponse } from "next/server";
import { agentRuntime } from "../../../../../lib/agent-runtime";
import { validateRouteParams } from "../../../../../lib/validation/helpers";
import { QuoteDB } from "../../../../../services/database";
import type { QuoteMemory } from "../../../../../types";
import {
  ExecutedQuoteResponseSchema,
  GetExecutedQuoteParamsSchema,
} from "../../../../../types/validation/api-schemas";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await agentRuntime.getRuntime();

  const routeParams = await params;
  const validatedParams = validateRouteParams(GetExecutedQuoteParamsSchema, routeParams);

  const { id: quoteId } = validatedParams;

  // Lookup quote - handle not found at boundary
  let quote: QuoteMemory | null = null;

  // First try QuoteDB/QuoteService (the standard path)
  try {
    quote = await QuoteDB.getQuoteByQuoteId(quoteId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("[Quote Executed API] QuoteDB lookup failed:", message);
    // Fall through to direct cache lookup below
  }

  // If QuoteDB fails, try direct cache lookup as fallback
  // This handles cases where the quote was saved directly to cache
  if (!quote) {
    const cacheKey = `quote:${quoteId}`;
    console.log("[Quote Executed API] Trying direct cache lookup:", cacheKey);
    const cachedQuote = await runtime.getCache<QuoteMemory>(cacheKey);
    if (cachedQuote) {
      console.log("[Quote Executed API] Found quote in direct cache lookup:", {
        quoteId: cachedQuote.quoteId,
        status: cachedQuote.status,
      });
      quote = cachedQuote;
    }
  }

  // If still not found, return 404
  if (!quote) {
    console.warn("[Quote Executed API] Quote not found by any method:", quoteId);
    return NextResponse.json({ error: `Quote ${quoteId} not found` }, { status: 404 });
  }

  // Allow active, approved, and executed quotes to be viewed
  // active = quote created, approved = offer created/approved on-chain, executed = paid/fulfilled
  if (quote.status !== "executed" && quote.status !== "active" && quote.status !== "approved") {
    console.warn("[Quote Executed API] Invalid status:", {
      quoteId,
      status: quote.status,
    });
    return NextResponse.json({ error: "Quote not found or invalid status" }, { status: 400 });
  }

  const formattedQuote = {
    quoteId: quote.quoteId,
    entityId: quote.entityId,
    beneficiary: quote.beneficiary,
    status: quote.status,
    offerId: quote.offerId,
    tokenAmount: quote.tokenAmount,
    lockupMonths: quote.lockupMonths,
    discountBps: quote.discountBps,
    totalUsd: quote.totalUsd,
    discountUsd: quote.discountUsd,
    discountedUsd: quote.discountedUsd,
    paymentAmount: quote.paymentAmount,
    paymentCurrency: quote.paymentCurrency,
    transactionHash: quote.transactionHash,
    blockNumber: quote.blockNumber,
    // Optional chain hint for UI display ("evm" | "solana")
    chain: quote.chain,
  };

  const response = { success: true, quote: formattedQuote };
  const validatedResponse = ExecutedQuoteResponseSchema.parse(response);
  return NextResponse.json(validatedResponse);
}
