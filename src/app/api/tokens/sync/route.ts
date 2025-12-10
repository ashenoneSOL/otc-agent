import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { TokenRegistryService } from "@/services/tokenRegistry";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/**
 * Sync a specific token registration immediately after on-chain registration
 * This endpoint can be called from the frontend after a transaction confirms
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chain, transactionHash, blockNumber } = body;

    if (!chain || !transactionHash) {
      return NextResponse.json(
        { success: false, error: "Missing chain or transactionHash" },
        { status: 400 },
      );
    }

    if (chain === "base" || chain === "bsc" || chain === "ethereum" || chain === "jeju") {
      return await syncEvmToken(transactionHash, blockNumber, chain);
    } else {
      return NextResponse.json(
        { success: false, error: "Unsupported chain" },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("[Sync API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * Sync EVM token registration immediately (Base, BSC, Jeju)
 */
async function syncEvmToken(
  transactionHash: string,
  blockNumber: string | undefined,
  chain: string,
) {
  const { base, bsc } = await import("viem/chains");

  const registrationHelperAddress =
    chain === "bsc"
      ? process.env.NEXT_PUBLIC_BSC_REGISTRATION_HELPER_ADDRESS
      : process.env.NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS;

  if (!registrationHelperAddress) {
    return NextResponse.json(
      {
        success: false,
        error: `REGISTRATION_HELPER_ADDRESS not configured for ${chain}`,
      },
      { status: 500 },
    );
  }

  const rpcUrl =
    chain === "bsc"
      ? process.env.NEXT_PUBLIC_BSC_RPC_URL ||
        "https://bsc-dataseed1.binance.org"
      : chain === "jeju"
        ? process.env.NEXT_PUBLIC_JEJU_RPC_URL || "https://rpc.jeju.network"
        : process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

  const viemChain = chain === "bsc" ? bsc : base;
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  try {
    const receipt = await client.getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });
    if (!receipt) {
      return NextResponse.json(
        { success: false, error: "Transaction not found" },
        { status: 404 },
      );
    }

    const txBlock = receipt.blockNumber;
    const startBlock = blockNumber ? BigInt(blockNumber) : txBlock;
    const endBlock = txBlock;

    console.log(
      `[Sync ${chain.toUpperCase()}] Fetching events from block ${startBlock} to ${endBlock}`,
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
          { type: "address", name: "registeredBy", indexed: true },
        ],
      },
      fromBlock: startBlock,
      toBlock: endBlock,
    });

    const txLogs = logs.filter(
      (log) => log.transactionHash === transactionHash,
    );

    if (txLogs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No TokenRegistered event found in transaction",
        },
        { status: 404 },
      );
    }

    let processed = 0;
    const processedTokens: string[] = [];

    for (const log of txLogs) {
      try {
        const { tokenAddress, registeredBy } = log.args as {
          tokenId: string;
          tokenAddress: string;
          pool: string;
          registeredBy: string;
        };

        console.log(
          `[Sync ${chain.toUpperCase()}] Processing token registration: ${tokenAddress} by ${registeredBy}`,
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
        const dbChain = chain === "bsc" ? "bsc" : chain === "jeju" ? "jeju" : "base";
        const token = await tokenService.registerToken({
          symbol: symbol as string,
          name: name as string,
          contractAddress: tokenAddress.toLowerCase(),
          chain: dbChain,
          decimals: Number(decimals),
          logoUrl: undefined,
          description: `Registered via RegistrationHelper by ${registeredBy}`,
        });

        processed++;
        processedTokens.push(token.id);
        console.log(
          `[Sync ${chain.toUpperCase()}] ✅ Registered ${symbol} (${tokenAddress})`,
        );
      } catch (error) {
        console.error(
          `[Sync ${chain.toUpperCase()}] Failed to process event:`,
          error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      tokens: processedTokens,
      message: `Successfully synced ${processed} token(s) on ${chain}`,
    });
  } catch (error) {
    console.error(`[Sync ${chain.toUpperCase()}] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
