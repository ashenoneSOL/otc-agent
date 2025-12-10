import { NextRequest, NextResponse } from "next/server";

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  chain: string;
  priceUsd: number | null;
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function lookupEvmToken(
  address: string,
  chain: string,
  alchemyKey: string,
): Promise<TokenInfo | null> {
  const alchemyNetwork = chain === "bsc" ? "bnb-mainnet" : "base-mainnet";
  const url = `https://${alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getTokenMetadata",
        params: [address],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const result = data.result;

    if (!result || !result.symbol) return null;

    return {
      address: address.toLowerCase(),
      symbol: result.symbol || "ERC20",
      name: result.name || "Unknown Token",
      decimals: result.decimals ?? 18,
      logoUrl: result.logo || null,
      chain,
      priceUsd: null,
    };
  } catch (error) {
    console.error("[Token Lookup] Alchemy error:", error);
    return null;
  }
}

/**
 * GET /api/token-lookup?address=0x...&chain=base
 * Looks up a single EVM token by contract address.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const chain = request.nextUrl.searchParams.get("chain") || "base";

  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  if (!isEvmAddress(address)) {
    return NextResponse.json(
      { error: "Invalid EVM address format" },
      { status: 400 },
    );
  }

  const alchemyKey = process.env.ALCHEMY_API_KEY;
  if (!alchemyKey) {
    return NextResponse.json(
      { error: "EVM token lookup not configured" },
      { status: 503 },
    );
  }

  const token = await lookupEvmToken(address, chain, alchemyKey);

  if (!token) {
    return NextResponse.json(
      { error: "Token not found", address, chain },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    token,
  });
}
