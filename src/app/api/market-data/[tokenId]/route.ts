import { NextRequest, NextResponse } from "next/server";
import { TokenDB, MarketDataDB } from "@/services/database";
import { MarketDataService } from "@/services/marketDataService";

// Check if we're in local development mode (no external API calls needed)
function isLocalDevelopment(_chain: string, contractAddress: string): boolean {
  // EVM local testnet (Anvil deploys to predictable addresses)
  return (
    contractAddress.startsWith("0x5FbDB") ||
    contractAddress.startsWith("0x5fbdb") ||
    contractAddress.startsWith("0xe7f1725")
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params;

  try {
    let marketData = await MarketDataDB.getMarketData(tokenId);

    if (!marketData || Date.now() - marketData.lastUpdated > 300000) {
      const token = await TokenDB.getToken(tokenId);

      // Skip external API calls for local development
      if (!isLocalDevelopment(token.chain, token.contractAddress)) {
        const service = new MarketDataService();
        await service.refreshTokenData(
          tokenId,
          token.contractAddress,
          token.chain,
        );
        marketData = await MarketDataDB.getMarketData(tokenId);
      }
    }

    return NextResponse.json({
      success: true,
      marketData,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch market data",
      },
      { status: 404 },
    );
  }
}
