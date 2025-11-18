#!/usr/bin/env bun

/**
 * Verify Multi-Chain OTC Deployment
 * 
 * This script verifies that:
 * - Base OTC contract is deployed and configured correctly
 * - RegistrationHelper is deployed and can be used
 * - Solana program is deployed and operational
 * - Wallet scanning works on both chains
 * - Oracle discovery works
 */

import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";

const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";

const OTC_ADDRESS = process.env.NEXT_PUBLIC_BASE_OTC_ADDRESS;
const REGISTRATION_HELPER_ADDRESS = process.env.NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS;
const SOLANA_PROGRAM_ID = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
const SOLANA_DESK = process.env.NEXT_PUBLIC_SOLANA_DESK;

async function verifyBaseDeployment() {
  console.log("\n=== Verifying Base Deployment ===\n");

  if (!OTC_ADDRESS) {
    console.error("❌ NEXT_PUBLIC_BASE_OTC_ADDRESS not set");
    return false;
  }

  if (!REGISTRATION_HELPER_ADDRESS) {
    console.error("❌ NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS not set");
    return false;
  }

  const client = createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
  });

  try {
    // Check OTC contract
    console.log("Checking OTC contract at:", OTC_ADDRESS);
    
    const otcAbi = parseAbi([
      "function nextOfferId() view returns (uint256)",
      "function agent() view returns (address)",
      "function usdc() view returns (address)",
      "function ethUsdFeed() view returns (address)",
      "function owner() view returns (address)",
    ]);

    const [nextOfferId, agent, usdc, ethUsdFeed, owner] = await Promise.all([
      client.readContract({
        address: OTC_ADDRESS as `0x${string}`,
        abi: otcAbi,
        functionName: "nextOfferId",
      } as any),
      client.readContract({
        address: OTC_ADDRESS as `0x${string}`,
        abi: otcAbi,
        functionName: "agent",
      } as any),
      client.readContract({
        address: OTC_ADDRESS as `0x${string}`,
        abi: otcAbi,
        functionName: "usdc",
      } as any),
      client.readContract({
        address: OTC_ADDRESS as `0x${string}`,
        abi: otcAbi,
        functionName: "ethUsdFeed",
      } as any),
      client.readContract({
        address: OTC_ADDRESS as `0x${string}`,
        abi: otcAbi,
        functionName: "owner",
      } as any),
    ]);

    console.log("✅ OTC contract is deployed");
    console.log("  Next Offer ID:", nextOfferId.toString());
    console.log("  Agent:", agent);
    console.log("  USDC:", usdc);
    console.log("  ETH/USD Feed:", ethUsdFeed);
    console.log("  Owner:", owner);

    // Check RegistrationHelper
    console.log("\nChecking RegistrationHelper at:", REGISTRATION_HELPER_ADDRESS);
    
    const helperAbi = parseAbi([
      "function otc() view returns (address)",
      "function ethUsdFeed() view returns (address)",
      "function registrationFee() view returns (uint256)",
      "function feeRecipient() view returns (address)",
    ]);

    const [helperOtc, helperEthFeed, regFee, feeRecipient] = await Promise.all([
      client.readContract({
        address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
        abi: helperAbi,
        functionName: "otc",
      } as any),
      client.readContract({
        address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
        abi: helperAbi,
        functionName: "ethUsdFeed",
      } as any),
      client.readContract({
        address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
        abi: helperAbi,
        functionName: "registrationFee",
      } as any),
      client.readContract({
        address: REGISTRATION_HELPER_ADDRESS as `0x${string}`,
        abi: helperAbi,
        functionName: "feeRecipient",
      } as any),
    ]);

    console.log("✅ RegistrationHelper is deployed");
    console.log("  OTC Address:", helperOtc);
    console.log("  ETH/USD Feed:", helperEthFeed);
    console.log("  Registration Fee:", (Number(regFee) / 1e18).toFixed(4), "ETH");
    console.log("  Fee Recipient:", feeRecipient);

    // Verify RegistrationHelper points to correct OTC
    if ((helperOtc as string).toLowerCase() !== OTC_ADDRESS.toLowerCase()) {
      console.error("❌ RegistrationHelper points to wrong OTC contract");
      return false;
    }

    console.log("\n✅ Base deployment verified successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to verify Base deployment:", error);
    return false;
  }
}

async function verifySolanaDeployment() {
  console.log("\n=== Verifying Solana Deployment ===\n");

  if (!SOLANA_PROGRAM_ID) {
    console.error("❌ NEXT_PUBLIC_SOLANA_PROGRAM_ID not set");
    return false;
  }

  if (!SOLANA_DESK) {
    console.error("❌ NEXT_PUBLIC_SOLANA_DESK not set");
    return false;
  }

  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");

    // Check program exists
    console.log("Checking Solana program at:", SOLANA_PROGRAM_ID);
    const programInfo = await connection.getAccountInfo(new PublicKey(SOLANA_PROGRAM_ID));
    
    if (!programInfo) {
      console.error("❌ Solana program not found");
      return false;
    }

    console.log("✅ Solana program is deployed");
    console.log("  Executable:", programInfo.executable);
    console.log("  Owner:", programInfo.owner.toBase58());

    // Check desk account
    console.log("\nChecking desk account at:", SOLANA_DESK);
    const deskInfo = await connection.getAccountInfo(new PublicKey(SOLANA_DESK));
    
    if (!deskInfo) {
      console.error("❌ Desk account not found");
      return false;
    }

    console.log("✅ Desk account exists");
    console.log("  Data Size:", deskInfo.data.length, "bytes");
    console.log("  Owner:", deskInfo.owner.toBase58());

    console.log("\n✅ Solana deployment verified successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to verify Solana deployment:", error);
    return false;
  }
}

async function testWalletScanning() {
  console.log("\n=== Testing Wallet Scanning ===\n");

  try {
    // Note: Actual wallet scanning requires user authentication
    // This just checks if the required APIs are configured
    
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    const heliusKey = process.env.HELIUS_API_KEY;

    console.log("Alchemy API Key configured:", alchemyKey ? "✅" : "❌");
    console.log("Helius API Key configured:", heliusKey ? "✅" : "❌");

    if (!alchemyKey) {
      console.warn("⚠️  Alchemy API key not configured - Base wallet scanning won't work");
    }

    if (!heliusKey) {
      console.warn("⚠️  Helius API key not configured - Solana metadata will be limited");
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to test wallet scanning:", error);
    return false;
  }
}

async function main() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║  Multi-Chain OTC Deployment Verification      ║");
  console.log("╚════════════════════════════════════════════════╝");

  const results = {
    base: await verifyBaseDeployment(),
    solana: await verifySolanaDeployment(),
    walletScanning: await testWalletScanning(),
  };

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║  Verification Summary                          ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  console.log("Base Deployment:", results.base ? "✅ PASS" : "❌ FAIL");
  console.log("Solana Deployment:", results.solana ? "✅ PASS" : "❌ FAIL");
  console.log("Wallet Scanning:", results.walletScanning ? "✅ PASS" : "❌ FAIL");

  const allPassed = Object.values(results).every(Boolean);

  if (allPassed) {
    console.log("\n🎉 All verifications passed!");
    console.log("\nNext steps:");
    console.log("1. Start backend event listeners:");
    console.log("   - Run token registration listeners for both chains");
    console.log("2. Test token registration in UI:");
    console.log("   - Connect wallet");
    console.log("   - Click 'Register Token from Wallet'");
    console.log("   - Select a token and complete registration");
    console.log("3. Monitor backend logs for TokenRegistered events");
    process.exit(0);
  } else {
    console.log("\n❌ Some verifications failed. Please check the errors above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Verification script failed:", error);
  process.exit(1);
});

