// quote action - generate a new ELIZA quote and return an XML object to the frontend

import {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  Content,
  ActionResult,
} from "@elizaos/core";
import {
  setUserQuote,
  getUserQuote,
  deleteUserQuote,
} from "../providers/quote";
import {
  getElizaPriceUsd,
  getEthPriceUsd,
  ELIZA_TOKEN,
  formatElizaAmount,
} from "../services/priceFeed";
import { addQuoteToHistory, updateQuoteStatus } from "../services/quoteHistory";
import { notificationService } from "../services/notifications";

function generateQuoteId(): string {
  return `Q${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
}

function parseQuoteRequest(text: string): {
  tokenAmount?: string;
  discountBps?: number;
  paymentCurrency?: "ETH" | "USDC";
} {
  const result: any = {};

  // Parse token amount (various formats)
  const amountMatch = text.match(
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:tokens?|eliza)?/i,
  );
  if (amountMatch) {
    result.tokenAmount = amountMatch[1].replace(/,/g, "");
  }

  // Parse discount (percentage or bps)
  const discountMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:%|percent|bps|basis)/i,
  );
  if (discountMatch) {
    const value = parseFloat(discountMatch[1]);
    // If it's a percentage (has % or "percent"), convert to bps
    if (
      discountMatch[0].includes("%") ||
      discountMatch[0].includes("percent")
    ) {
      result.discountBps = Math.round(value * 100);
    } else {
      result.discountBps = Math.round(value);
    }
  }

  // Parse payment currency
  if (/(\b(eth|ethereum)\b)/i.test(text)) {
    result.paymentCurrency = "ETH";
  } else if (/(\b(usdc|usd|dollar)\b)/i.test(text)) {
    result.paymentCurrency = "USDC";
  }

  return result;
}

// ---------------- Negotiation support (discount/lockup) ----------------
const MIN_USD_AMOUNT = 5; // $5 minimum
const MAX_DISCOUNT_BPS = 2500; // 25% maximum discount

function parseNegotiationRequest(text: string): {
  tokenAmount?: string;
  requestedDiscountBps?: number;
  lockupMonths?: number;
  paymentCurrency?: "ETH" | "USDC";
} {
  const result: any = {};

  // Token amount (reuse existing regex)
  const amountMatch = text.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:tokens?|eliza)?/i);
  if (amountMatch) {
    result.tokenAmount = amountMatch[1].replace(/,/g, "");
  }

  // Discount request
  const discountMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|bps|basis|discount)/i);
  if (discountMatch) {
    const value = parseFloat(discountMatch[1]);
    if (discountMatch[0].includes("bps") || discountMatch[0].includes("basis")) {
      result.requestedDiscountBps = Math.round(value);
    } else {
      result.requestedDiscountBps = Math.round(value * 100);
    }
  }

  // Lockup period
  const lockupMatch = text.match(/(\d+)\s*(?:month|months|mo|week|weeks|wk|day|days|d)/i);
  if (lockupMatch) {
    const value = parseInt(lockupMatch[1]);
    const unit = lockupMatch[0].toLowerCase();
    if (unit.includes("month") || unit.includes("mo")) {
      result.lockupMonths = value;
    } else if (unit.includes("week") || unit.includes("wk")) {
      result.lockupMonths = value / 4; // approx weeks->months
    } else if (unit.includes("day") || unit.includes("d")) {
      result.lockupMonths = value / 30; // approx days->months
    }
  }

  // Payment currency
  if (/(\b(eth|ethereum)\b)/i.test(text)) {
    result.paymentCurrency = "ETH";
  } else if (/(\b(usdc|usd|dollar)\b)/i.test(text)) {
    result.paymentCurrency = "USDC";
  }

  return result;
}

function clampDiscountBps(discountBps: number): number {
  return Math.max(0, Math.min(MAX_DISCOUNT_BPS, Math.round(discountBps)));
}

async function negotiateTerms(
  _runtime: IAgentRuntime,
  request: any,
  existingQuote: any,
): Promise<{
  tokenAmount: string;
  lockupMonths: number;
  discountBps: number;
  paymentCurrency: "ETH" | "USDC";
  reasoning: string;
}> {
  let lockupMonths = 5; // default

  if (request.lockupMonths) {
    lockupMonths = Math.max(0.25, Math.min(12, request.lockupMonths));
  }

  // Requested discount or default based on existing quote
  let discountBps = clampDiscountBps(
    request.requestedDiscountBps ?? existingQuote?.discountBps ?? 800,
  );

  // Adjust lockup guidance for larger discounts
  if (discountBps >= 2000 && lockupMonths < 6) lockupMonths = 6;
  if (discountBps >= 2500 && lockupMonths < 9) lockupMonths = 9;

  const tokenAmount = request.tokenAmount || existingQuote?.tokenAmount || "1000";

  const reasoning = `I can offer a ${(
    discountBps / 100
  ).toFixed(2)}% discount with a ${lockupMonths}-month lockup.`;

  return {
    tokenAmount,
    lockupMonths,
    discountBps,
    paymentCurrency: request.paymentCurrency || existingQuote?.paymentCurrency || "USDC",
    reasoning,
  };
}

export const quoteAction: Action = {
  name: "CREATE_OTC_QUOTE",
  similes: [
    "generate quote",
    "create quote",
    "new quote",
    "quote me",
    "get quote",
    "quote",
    "update quote",
    "modify quote",
    "negotiate",
    "price check",
  ],
  description: "Generate or update a quote with negotiated terms",

  validate: async () => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const userId =
        (message as any).userId ||
        (message as any).entityId ||
        (message as any).roomId ||
        "default";
      const text = message.content?.text || "";

      // Check for quote cancellation
      if (
        text.toLowerCase().includes("cancel") ||
        text.toLowerCase().includes("delete")
      ) {
        const existingQuote = getUserQuote(userId);
        if (existingQuote) {
          deleteUserQuote(userId);
          updateQuoteStatus(userId, existingQuote.quoteId, {
            status: "rejected",
            rejectionReason: "User cancelled",
          });
          notificationService.notifyQuoteRejected(
            userId,
            existingQuote.quoteId,
            "User cancelled",
          );
        }

        if (callback) {
          await callback({
            text: "Your ELIZA quote has been cancelled.",
            action: "QUOTE_CANCELLED",
          });
        }
        return { success: true };
      }

      // Parse the request(s)
      const request = parseQuoteRequest(text);
      const negotiationRequest = parseNegotiationRequest(text);

      // Get existing quote or use defaults
      const existingQuote = getUserQuote(userId);

      // Determine whether this is a negotiation-style request
      const isNegotiation =
        /negotiate|discount|lockup|month/i.test(text) ||
        negotiationRequest.requestedDiscountBps !== undefined ||
        negotiationRequest.lockupMonths !== undefined;

      // Shared prices
      const [priceUsdPerToken] = await Promise.all([getElizaPriceUsd()]);

      if (isNegotiation) {
        // Compute negotiated terms
        const negotiated = await negotiateTerms(runtime, negotiationRequest, existingQuote);

        // Compute values
        const tokenAmountNum = parseFloat(negotiated.tokenAmount);
        const totalUsd = tokenAmountNum * priceUsdPerToken;
        const discountUsd = totalUsd * (negotiated.discountBps / 10000);
        const discountedUsd = totalUsd - discountUsd;

        // Validate min order
        if (discountedUsd < MIN_USD_AMOUNT) {
          if (callback) {
            await callback({
              text: `❌ Order too small. Minimum order value is $${MIN_USD_AMOUNT} after discount. Your order would be $${discountedUsd.toFixed(2)}.`,
              action: "QUOTE_ERROR",
            });
          }
          return { success: false };
        }

        const ethPriceUsd = negotiated.paymentCurrency === "ETH" ? await getEthPriceUsd() : 0;

        // Generate quote
        const quoteId = generateQuoteId();
        const now = Date.now();
        const expiresAt = now + 5 * 60 * 1000;
        const lockupDays = Math.round(negotiated.lockupMonths * 30);

        // Payment amount
        const paymentAmount = negotiated.paymentCurrency === "ETH"
          ? (discountedUsd / ethPriceUsd).toFixed(6)
          : discountedUsd.toFixed(2);
        const paymentSymbol = negotiated.paymentCurrency === "ETH" ? "ETH" : "USDC";

        const quote = {
          tokenAmount: negotiated.tokenAmount,
          discountBps: negotiated.discountBps,
          paymentCurrency: negotiated.paymentCurrency,
          priceUsdPerToken,
          totalUsd,
          discountedUsd,
          expiresAt,
          createdAt: now,
          quoteId,
          lockupMonths: negotiated.lockupMonths,
          paymentAmount,
        };

        await setUserQuote(userId, quote);

        addQuoteToHistory({
          quoteId,
          userId,
          tokenAmount: negotiated.tokenAmount,
          discountBps: negotiated.discountBps,
          paymentCurrency: negotiated.paymentCurrency,
          priceUsdPerToken,
          totalUsd,
          discountedUsd,
          status: "created",
          createdAt: now,
          expiresAt,
        });

        const formattedAmount = formatElizaAmount(negotiated.tokenAmount);
        const xmlResponse = `
<quote>
  <quoteId>${quoteId}</quoteId>
  <tokenAmount>${negotiated.tokenAmount}</tokenAmount>
  <tokenAmountFormatted>${formattedAmount}</tokenAmountFormatted>
  <tokenSymbol>${ELIZA_TOKEN.symbol}</tokenSymbol>
  <lockupMonths>${negotiated.lockupMonths}</lockupMonths>
  <lockupDays>${lockupDays}</lockupDays>
  <pricePerToken>${priceUsdPerToken.toFixed(8)}</pricePerToken>
  <totalValueUsd>${totalUsd.toFixed(2)}</totalValueUsd>
  <discountBps>${negotiated.discountBps}</discountBps>
  <discountPercent>${(negotiated.discountBps / 100).toFixed(2)}</discountPercent>
  <discountUsd>${discountUsd.toFixed(2)}</discountUsd>
  <finalPriceUsd>${discountedUsd.toFixed(2)}</finalPriceUsd>
  <paymentCurrency>${negotiated.paymentCurrency}</paymentCurrency>
  <paymentAmount>${paymentAmount}</paymentAmount>
  <paymentSymbol>${paymentSymbol}</paymentSymbol>
  ${negotiated.paymentCurrency === "ETH" ? `<ethPrice>${ethPriceUsd.toFixed(2)}</ethPrice>` : ""}
  <createdAt>${new Date(now).toISOString()}</createdAt>
  <expiresAt>${new Date(expiresAt).toISOString()}</expiresAt>
  <status>negotiated</status>
  <message>OTC quote updated. Valid upon submission; agent will verify against records.</message>
</quote>`;

        const textResponse = `${negotiated.reasoning}

📊 **Your Quote** (ID: ${quoteId})
• Amount: ${formattedAmount} ${ELIZA_TOKEN.symbol}
• **Discount: ${(negotiated.discountBps / 100).toFixed(2)}%**
• **Lockup: ${negotiated.lockupMonths} months** (${lockupDays} days)
• Your Price: $${discountedUsd.toFixed(2)} (${paymentAmount} ${paymentSymbol})
• You Save: $${discountUsd.toFixed(2)}

✅ Quote is valid upon on-chain submission; the agent will confirm it matches our records.

To accept: Say "accept" or "confirm"
To negotiate: Tell me your preferred discount or lockup period`;

        if (callback) {
          await callback({
            text: textResponse + "\n\n<!-- XML_START -->\n" + xmlResponse + "\n<!-- XML_END -->",
            action: "QUOTE_NEGOTIATED",
            content: { xml: xmlResponse, quote, type: "otc_quote" } as Content,
          });
        }

        return { success: true };
      }

      // ------------- Simple discount-based quote (legacy path) -------------
      const tokenAmount = request.tokenAmount || existingQuote?.tokenAmount || "100000";
      const discountBps = request.discountBps ?? existingQuote?.discountBps ?? 1000; // Default 10%
      const paymentCurrency = request.paymentCurrency || existingQuote?.paymentCurrency || "USDC";

      if (discountBps < 0 || discountBps > MAX_DISCOUNT_BPS) {
        if (callback) {
          await callback({
            text: "❌ Invalid discount. Please specify a discount between 0% and 25%.",
            action: "QUOTE_ERROR",
          });
        }
        return { success: false };
      }

      const ethPriceUsd = paymentCurrency === "ETH" ? await getEthPriceUsd() : 0;

      const tokenAmountNum = parseFloat(tokenAmount);
      const totalUsd = tokenAmountNum * priceUsdPerToken;
      const discountUsd = totalUsd * (discountBps / 10000);
      const discountedUsd = totalUsd - discountUsd;

      if (discountedUsd < MIN_USD_AMOUNT) {
        if (callback) {
          await callback({
            text: `❌ Order too small. Minimum order value is $${MIN_USD_AMOUNT} after discount.`,
            action: "QUOTE_ERROR",
          });
        }
        return { success: false };
      }

      const quoteId = generateQuoteId();
      const now = Date.now();
      const expiresAt = now + 5 * 60 * 1000;

      const paymentAmount = paymentCurrency === "ETH"
        ? (discountedUsd / ethPriceUsd).toFixed(6)
        : discountedUsd.toFixed(2);

      const quote = {
        tokenAmount,
        discountBps,
        paymentCurrency,
        priceUsdPerToken,
        totalUsd,
        discountedUsd,
        expiresAt,
        createdAt: now,
        quoteId,
        lockupMonths: 5,
        paymentAmount,
      };

      await setUserQuote(userId, quote);

      addQuoteToHistory({
        quoteId,
        userId,
        tokenAmount,
        discountBps,
        paymentCurrency,
        priceUsdPerToken,
        totalUsd,
        discountedUsd,
        status: "created",
        createdAt: now,
        expiresAt,
      });

      notificationService.notifyQuoteCreated(userId, {
        quoteId,
        tokenAmount,
        discountBps,
        totalUsd,
        discountedUsd,
      });

      const paymentSymbol = paymentCurrency === "ETH" ? "ETH" : "USDC";
      const formattedAmount = formatElizaAmount(tokenAmount);

      const xmlResponse = `
<quote>
  <quoteId>${quoteId}</quoteId>
  <tokenAmount>${tokenAmount}</tokenAmount>
  <tokenAmountFormatted>${formattedAmount}</tokenAmountFormatted>
  <tokenSymbol>${ELIZA_TOKEN.symbol}</tokenSymbol>
  <tokenName>${ELIZA_TOKEN.name}</tokenName>
  <lockupMonths>5</lockupMonths>
  <lockupDays>150</lockupDays>
  <pricePerToken>${priceUsdPerToken.toFixed(8)}</pricePerToken>
  <totalValueUsd>${totalUsd.toFixed(2)}</totalValueUsd>
  <discountBps>${discountBps}</discountBps>
  <discountPercent>${(discountBps / 100).toFixed(2)}</discountPercent>
  <discountUsd>${discountUsd.toFixed(2)}</discountUsd>
  <finalPriceUsd>${discountedUsd.toFixed(2)}</finalPriceUsd>
  <paymentCurrency>${paymentCurrency}</paymentCurrency>
  <paymentAmount>${paymentAmount}</paymentAmount>
  <paymentSymbol>${paymentSymbol}</paymentSymbol>
  ${paymentCurrency === "ETH" ? `<ethPrice>${ethPriceUsd.toFixed(2)}</ethPrice>` : ""}
  <createdAt>${new Date(now).toISOString()}</createdAt>
  <expiresAt>${new Date(expiresAt).toISOString()}</expiresAt>
  <status>created</status>
  <message>OTC quote generated. Valid upon submission; agent will verify against records.</message>
</quote>`;

      const textResponse = `
Hey! I can offer you a great deal right now.

📊 **Order Details:**
• Amount: ${formattedAmount} ELIZA
• Market Price: $${priceUsdPerToken.toFixed(8)}/ELIZA
• Total Value: $${totalUsd.toFixed(2)}

💎 **Your Discount:**
• Discount Rate: ${(discountBps / 100).toFixed(2)}% (${discountBps} bps)
• You Save: $${discountUsd.toFixed(2)}
• **Your Price: $${discountedUsd.toFixed(2)}**`.trim();

      if (callback) {
        await callback({
          text: textResponse + "\n\n<!-- XML_START -->\n" + xmlResponse + "\n<!-- XML_END -->",
          action: "QUOTE_GENERATED",
          content: { xml: xmlResponse, quote, type: "otc_quote" } as Content,
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Error generating ELIZA quote:", error);
      if (callback) {
        await callback({
          text: "❌ Failed to generate quote. Please try again.",
          action: "QUOTE_ERROR",
        });
      }
      return { success: false };
    }
  },

  examples: [],
};
