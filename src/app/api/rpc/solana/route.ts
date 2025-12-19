import { NextRequest, NextResponse } from "next/server";
import { getHeliusApiKey } from "@/config/env";

// Proxy RPC requests to Helius to keep API key server-side
// This prevents the Helius API key from being exposed in the browser

export async function POST(request: NextRequest) {
  const heliusKey = getHeliusApiKey();
  if (!heliusKey) {
    console.error("[Solana RPC Proxy] HELIUS_API_KEY not configured");
    return NextResponse.json(
      { error: "Solana RPC not configured" },
      { status: 500 },
    );
  }
  
  const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

  try {
    const body = await request.json();

    const response = await fetch(HELIUS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[Solana RPC Proxy] Helius error:",
        response.status,
        response.statusText,
        errorText,
      );
      return NextResponse.json(
        { error: "Solana RPC request failed", details: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Solana RPC Proxy] Error:", error);
    return NextResponse.json({ error: "Solana RPC proxy error" }, { status: 500 });
  }
}

// Also support GET for health checks
export async function GET() {
  const heliusKey = getHeliusApiKey();
  if (!heliusKey) {
    return NextResponse.json(
      { status: "error", message: "HELIUS_API_KEY not configured" },
      { status: 500 },
    );
  }
  
  return NextResponse.json({ status: "ok", provider: "helius" });
}


