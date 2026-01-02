import { type NextRequest, NextResponse } from "next/server";
import { findBestSolanaPool, type SolanaPoolInfo } from "../../../../utils/pool-finder-solana";

interface FindPoolRequest {
  tokenMint: string;
  cluster?: "mainnet" | "devnet";
}

interface FindPoolResponse {
  success: boolean;
  pool: SolanaPoolInfo | null;
  error?: string;
}

/**
 * Find the best liquidity pool for a Solana token
 * This runs server-side to avoid CSP issues with external API calls
 */
export async function POST(request: NextRequest): Promise<NextResponse<FindPoolResponse>> {
  let body: FindPoolRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, pool: null, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { tokenMint, cluster = "mainnet" } = body;

  if (!tokenMint || typeof tokenMint !== "string") {
    return NextResponse.json(
      { success: false, pool: null, error: "tokenMint is required" },
      { status: 400 },
    );
  }

  try {
    const pool = await findBestSolanaPool(tokenMint, cluster);
    return NextResponse.json({ success: true, pool });
  } catch (error) {
    console.error("[find-pool] Error finding pool:", error);
    return NextResponse.json(
      {
        success: false,
        pool: null,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
