import type { Chain, Token, TokenMarketData, OTCConsignment, ConsignmentDeal } from "@/types";
import type { QuoteMemory as Quote, QuoteStatus, PaymentCurrency } from "@/lib/plugin-otc-desk/types";

const CLOUD_URL = process.env.NEXT_PUBLIC_ELIZA_CLOUD_URL || "http://localhost:3000";

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("miniapp_auth_token");
}

async function cloudRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["X-Miniapp-Token"] = token;
  }

  const response = await fetch(`${CLOUD_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Cloud storage request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function ensureCollection(name: string): Promise<void> {
  try {
    await cloudRequest("POST", "/api/v1/miniapp/storage", {
      name,
      schema: { type: "object" },
    });
  } catch {
    // Collection may already exist
  }
}

export class CloudQuoteDB {
  private static readonly COLLECTION = "quotes";

  static async init(): Promise<void> {
    await ensureCollection(this.COLLECTION);
  }

  static async createQuote(data: {
    entityId: string;
    beneficiary: string;
    tokenAmount: string;
    discountBps: number;
    apr: number;
    lockupMonths: number;
    paymentCurrency: PaymentCurrency;
    totalUsd: number;
    discountUsd: number;
    discountedUsd: number;
    paymentAmount: string;
  }): Promise<Quote> {
    const quoteId = `quote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const quote: Quote = {
      id: quoteId,
      quoteId,
      entityId: data.entityId,
      beneficiary: data.beneficiary,
      tokenAmount: data.tokenAmount,
      discountBps: data.discountBps,
      apr: data.apr,
      lockupMonths: data.lockupMonths,
      lockupDays: data.lockupMonths * 30,
      paymentCurrency: data.paymentCurrency,
      priceUsdPerToken: 0,
      totalUsd: data.totalUsd,
      discountUsd: data.discountUsd,
      discountedUsd: data.discountedUsd,
      paymentAmount: data.paymentAmount,
      status: "active" as QuoteStatus,
      signature: "",
      createdAt: now,
      executedAt: 0,
      rejectedAt: 0,
      approvedAt: 0,
      offerId: "",
      transactionHash: "",
      blockNumber: 0,
      rejectionReason: "",
      approvalNote: "",
    };

    const result = await cloudRequest<{ document: { id: string } }>(
      "POST",
      `/api/v1/miniapp/storage/${this.COLLECTION}`,
      { data: quote },
    );

    return { ...quote, id: result.document.id };
  }

  static async getQuoteByQuoteId(quoteId: string): Promise<Quote | null> {
    const result = await cloudRequest<{ documents: Array<{ data: Quote }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify({ quoteId }))}`,
    );
    return result.documents[0]?.data || null;
  }

  static async updateQuoteStatus(
    quoteId: string,
    status: QuoteStatus,
    data: Partial<Quote>,
  ): Promise<Quote | null> {
    const existing = await this.getQuoteByQuoteId(quoteId);
    if (!existing) return null;

    const updated = { ...existing, ...data, status };
    await cloudRequest(
      "PUT",
      `/api/v1/miniapp/storage/${this.COLLECTION}/${existing.id}`,
      updated,
    );
    return updated;
  }

  static async getActiveQuotes(): Promise<Quote[]> {
    const result = await cloudRequest<{ documents: Array<{ data: Quote }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify({ status: "active" }))}`,
    );
    return result.documents.map((d) => d.data);
  }
}

export class CloudTokenDB {
  private static readonly COLLECTION = "tokens";

  static async init(): Promise<void> {
    await ensureCollection(this.COLLECTION);
  }

  static async createToken(
    data: Omit<Token, "id" | "createdAt" | "updatedAt">,
  ): Promise<Token> {
    const tokenId = `token-${data.chain}-${data.contractAddress.toLowerCase()}`;
    const now = Date.now();

    const token: Token = {
      ...data,
      id: tokenId,
      createdAt: now,
      updatedAt: now,
    };

    await cloudRequest(
      "POST",
      `/api/v1/miniapp/storage/${this.COLLECTION}`,
      { data: token },
    );

    return token;
  }

  static async getToken(tokenId: string): Promise<Token | null> {
    const result = await cloudRequest<{ documents: Array<{ data: Token }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify({ id: tokenId }))}`,
    );
    return result.documents[0]?.data || null;
  }

  static async getAllTokens(filters?: {
    chain?: Chain;
    isActive?: boolean;
  }): Promise<Token[]> {
    const filter: Record<string, unknown> = {};
    if (filters?.chain) filter.chain = filters.chain;
    if (filters?.isActive !== undefined) filter.isActive = filters.isActive;

    const result = await cloudRequest<{ documents: Array<{ data: Token }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify(filter))}`,
    );
    return result.documents.map((d) => d.data);
  }

  static async updateToken(tokenId: string, updates: Partial<Token>): Promise<Token | null> {
    const existing = await this.getToken(tokenId);
    if (!existing) return null;

    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    await cloudRequest(
      "PATCH",
      `/api/v1/miniapp/storage/${this.COLLECTION}/${existing.id}`,
      updates,
    );
    return updated;
  }
}

export class CloudMarketDataDB {
  private static readonly COLLECTION = "market_data";

  static async init(): Promise<void> {
    await ensureCollection(this.COLLECTION);
  }

  static async setMarketData(data: TokenMarketData): Promise<void> {
    const existing = await this.getMarketData(data.tokenId);
    if (existing) {
      await cloudRequest(
        "PUT",
        `/api/v1/miniapp/storage/${this.COLLECTION}/${data.tokenId}`,
        data,
      );
    } else {
      await cloudRequest(
        "POST",
        `/api/v1/miniapp/storage/${this.COLLECTION}`,
        { data },
      );
    }
  }

  static async getMarketData(tokenId: string): Promise<TokenMarketData | null> {
    const result = await cloudRequest<{ documents: Array<{ data: TokenMarketData }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify({ tokenId }))}`,
    );
    return result.documents[0]?.data || null;
  }
}

export class CloudConsignmentDB {
  private static readonly COLLECTION = "consignments";

  static async init(): Promise<void> {
    await ensureCollection(this.COLLECTION);
  }

  static async createConsignment(
    data: Omit<OTCConsignment, "id" | "createdAt" | "updatedAt">,
  ): Promise<OTCConsignment> {
    const consignmentId = `consignment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const consignment: OTCConsignment = {
      ...data,
      id: consignmentId,
      createdAt: now,
      updatedAt: now,
    };

    await cloudRequest(
      "POST",
      `/api/v1/miniapp/storage/${this.COLLECTION}`,
      { data: consignment },
    );

    return consignment;
  }

  static async getConsignment(consignmentId: string): Promise<OTCConsignment | null> {
    const result = await cloudRequest<{ documents: Array<{ data: OTCConsignment }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify({ id: consignmentId }))}`,
    );
    return result.documents[0]?.data || null;
  }

  static async updateConsignment(
    consignmentId: string,
    updates: Partial<OTCConsignment>,
  ): Promise<OTCConsignment | null> {
    const existing = await this.getConsignment(consignmentId);
    if (!existing) return null;

    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    await cloudRequest(
      "PATCH",
      `/api/v1/miniapp/storage/${this.COLLECTION}/${existing.id}`,
      updates,
    );
    return updated;
  }

  static async getAllConsignments(filters?: {
    chain?: Chain;
    tokenId?: string;
    isNegotiable?: boolean;
  }): Promise<OTCConsignment[]> {
    const filter: Record<string, unknown> = { status: "active" };
    if (filters?.chain) filter.chain = filters.chain;
    if (filters?.tokenId) filter.tokenId = filters.tokenId;
    if (filters?.isNegotiable !== undefined) filter.isNegotiable = filters.isNegotiable;

    const result = await cloudRequest<{ documents: Array<{ data: OTCConsignment }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify(filter))}`,
    );
    return result.documents.map((d) => d.data);
  }

  static async getConsignmentsByConsigner(
    consignerAddress: string,
    includeWithdrawn = false,
  ): Promise<OTCConsignment[]> {
    const filter: Record<string, unknown> = { consignerAddress };
    if (!includeWithdrawn) {
      filter.status = { $ne: "withdrawn" };
    }

    const result = await cloudRequest<{ documents: Array<{ data: OTCConsignment }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify(filter))}`,
    );
    return result.documents.map((d) => d.data);
  }
}

export class CloudConsignmentDealDB {
  private static readonly COLLECTION = "consignment_deals";

  static async init(): Promise<void> {
    await ensureCollection(this.COLLECTION);
  }

  static async createDeal(data: Omit<ConsignmentDeal, "id">): Promise<ConsignmentDeal> {
    const dealId = `deal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const deal: ConsignmentDeal = {
      ...data,
      id: dealId,
    };

    await cloudRequest(
      "POST",
      `/api/v1/miniapp/storage/${this.COLLECTION}`,
      { data: deal },
    );

    return deal;
  }

  static async getDealsByConsignment(consignmentId: string): Promise<ConsignmentDeal[]> {
    const result = await cloudRequest<{ documents: Array<{ data: ConsignmentDeal }> }>(
      "GET",
      `/api/v1/miniapp/storage/${this.COLLECTION}?filter=${encodeURIComponent(JSON.stringify({ consignmentId }))}`,
    );
    return result.documents.map((d) => d.data);
  }
}

export async function initCloudStorage(): Promise<void> {
  await Promise.all([
    CloudQuoteDB.init(),
    CloudTokenDB.init(),
    CloudMarketDataDB.init(),
    CloudConsignmentDB.init(),
    CloudConsignmentDealDB.init(),
  ]);
}


