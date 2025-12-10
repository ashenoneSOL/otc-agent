import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { TokenRegistryService } from "@/services/tokenRegistry";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

let lastBaseBlock: bigint | null = null;

function getLastBaseBlock(): bigint | null {
  const envBlock = process.env.LAST_PROCESSED_BASE_BLOCK;
  if (envBlock) {
    return BigInt(envBlock);
  }
  return lastBaseBlock;
}

async function pollBaseRegistrations() {
  const registrationHelperAddress =
    process.env.NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS;
  if (!registrationHelperAddress) {
    console.error("[Cron] REGISTRATION_HELPER_ADDRESS not configured");
    return {
      processed: 0,
      error: "REGISTRATION_HELPER_ADDRESS not configured",
    };
  }

  const rpcUrl =
    process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  try {
    const latestBlock = await client.getBlockNumber();
    const savedBlock = getLastBaseBlock();
    const startBlock = savedBlock || latestBlock - BigInt(1000);

    if (startBlock >= latestBlock) {
      return { processed: 0, message: "Already up to date" };
    }

    console.log(
      `[Cron Base] Fetching events from block ${startBlock} to ${latestBlock}`,
    );

    const logs = await client.getLogs({
      address: registrationHelperAddress as `0x${string}`,
      event: {
        type: "event",
        name: "TokenRegistered",
        inputs: [
          { type: "bytes32", name: "tokenId", indexed: true },
          { type: "address", name: "tokenAddress", indexed: true },
          { type: "address", name: "pool", indexed: true },
          { type: "address", name: "oracle" },
          { type: "address", name: "registeredBy" },
        ],
      },
      fromBlock: startBlock,
      toBlock: latestBlock,
    });

    console.log(`[Cron Base] Found ${logs.length} TokenRegistered events`);

    let processed = 0;
    for (const log of logs) {
      const { tokenAddress, registeredBy } = log.args as {
        tokenId: string;
        tokenAddress: string;
        pool: string;
        registeredBy: string;
      };

      console.log(
        `[Cron Base] Processing token registration: ${tokenAddress} by ${registeredBy}`,
      );

      const readContract = client.readContract as (
        params: unknown,
      ) => Promise<unknown>;
      const [symbol, name, decimals] = await Promise.all([
        readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "name",
        }),
        readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);

      const tokenService = new TokenRegistryService();
      await tokenService.registerToken({
        symbol: symbol as string,
        name: name as string,
        contractAddress: tokenAddress.toLowerCase(),
        chain: "base",
        decimals: Number(decimals),
        logoUrl: undefined,
        description: `Registered via RegistrationHelper by ${registeredBy}`,
      });

      processed++;
      console.log(`[Cron Base] ✅ Registered ${symbol} (${tokenAddress})`);
    }

    lastBaseBlock = latestBlock;

    return { processed, latestBlock: latestBlock.toString() };
  } catch (error) {
    console.error("[Cron Base] Error:", error);
    return {
      processed: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === "production" && !cronSecret) {
    console.error("[Cron] No CRON_SECRET configured in production");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[Cron] Unauthorized access attempt", {
      ip:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip"),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron] Starting token registration poll...");

  const results = {
    base: {
      processed: 0,
      error: null as string | null,
      latestBlock: null as string | null,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const baseResult = await pollBaseRegistrations();
    results.base = {
      processed: baseResult.processed || 0,
      error: baseResult.error || null,
      latestBlock: baseResult.latestBlock || null,
    };
  } catch (error) {
    results.base.error =
      error instanceof Error ? error.message : "Unknown error";
  }

  return NextResponse.json({
    success: true,
    message: `Processed ${results.base.processed} new token registrations`,
    results,
  });
}
