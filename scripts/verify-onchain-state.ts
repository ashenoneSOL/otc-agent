#!/usr/bin/env bun
/**
 * On-Chain State Verification Script
 * Verifies the deployed state of OTC contracts on all chains
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http, type Address } from "viem";
import { base, bsc, mainnet } from "viem/chains";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

// Load configs
const mainnetEvmConfig = JSON.parse(fs.readFileSync("src/config/deployments/mainnet-evm.json", "utf8"));
const mainnetSolanaConfig = JSON.parse(fs.readFileSync("src/config/deployments/mainnet-solana.json", "utf8"));
const baseConfig = JSON.parse(fs.readFileSync("src/config/deployments/base-mainnet.json", "utf8"));

const HELIUS_KEY = process.env.HELIUS_API_KEY;

// ABIs
const OTC_ABI = [
  { name: "nextConsignmentId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "nextOfferId", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "owner", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "agent", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "approver", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "consignments", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }
  ], stateMutability: "view" },
  { name: "offers", type: "function", inputs: [{ type: "uint256" }], outputs: [
    { type: "uint256" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint8" }, { type: "bool" }, { type: "bool" },
    { type: "bool" }, { type: "bool" }, { type: "bool" }, { type: "address" }, { type: "uint256" }, { type: "uint16" }
  ], stateMutability: "view" },
] as const;

interface VerificationResult {
  chain: string;
  contractAddress: string;
  exists: boolean;
  nextConsignmentId?: number;
  nextOfferId?: number;
  activeConsignments?: number;
  activeOffers?: number;
  p2pOffers?: number;
  negotiableOffers?: number;
  paidOffers?: number;
  claimedOffers?: number;
  error?: string;
}

const results: VerificationResult[] = [];

async function verifyEvm(chainName: string, chain: typeof base, otcAddress: Address, rpcUrl: string) {
  console.log("\n📊 Verifying " + chainName + "...");
  console.log("   Contract: " + otcAddress);
  
  const result: VerificationResult = {
    chain: chainName,
    contractAddress: otcAddress,
    exists: false,
  };

  try {
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Check contract exists
    const code = await client.getBytecode({ address: otcAddress });
    if (!code || code === "0x") {
      result.error = "Contract not deployed";
      results.push(result);
      return;
    }
    
    result.exists = true;

    // Read state
    const [nextConsignmentId, nextOfferId, owner, agent] = await Promise.all([
      client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "nextConsignmentId" }),
      client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "nextOfferId" }),
      client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "owner" }),
      client.readContract({ address: otcAddress, abi: OTC_ABI, functionName: "agent" }),
    ]);

    result.nextConsignmentId = Number(nextConsignmentId);
    result.nextOfferId = Number(nextOfferId);

    console.log("   ✅ Contract deployed");
    console.log("   Owner: " + owner);
    console.log("   Agent: " + agent);
    console.log("   Next Consignment ID: " + nextConsignmentId);
    console.log("   Next Offer ID: " + nextOfferId);

    // Count active consignments and offers
    let activeOffers = 0;
    let p2pOffers = 0;
    let negotiableOffers = 0;
    let paidOffers = 0;
    let claimedOffers = 0;

    // Check offers
    for (let i = 1n; i < (nextOfferId as bigint); i++) {
      try {
        const offer = await client.readContract({
          address: otcAddress,
          abi: OTC_ABI,
          functionName: "offers",
          args: [i],
        });
        
        const approved = offer[11] as boolean;
        const paid = offer[12] as boolean;
        const executed = offer[13] as boolean;
        const cancelled = offer[14] as boolean;
        const commissionBps = offer[17] as number;
        
        if (!cancelled) {
          activeOffers++;
          if (commissionBps === 0 || commissionBps === 0n) {
            p2pOffers++;
          } else {
            negotiableOffers++;
          }
          if (paid) paidOffers++;
          if (executed) claimedOffers++;
        }
      } catch {
        // Skip invalid offers
      }
    }

    result.activeOffers = activeOffers;
    result.p2pOffers = p2pOffers;
    result.negotiableOffers = negotiableOffers;
    result.paidOffers = paidOffers;
    result.claimedOffers = claimedOffers;

    console.log("   Active Offers: " + activeOffers);
    console.log("   P2P Offers (commission=0): " + p2pOffers);
    console.log("   Negotiable Offers: " + negotiableOffers);
    console.log("   Paid Offers: " + paidOffers);
    console.log("   Claimed/Executed: " + claimedOffers);

  } catch (e) {
    result.error = String(e);
    console.log("   ❌ Error: " + e);
  }

  results.push(result);
}

async function verifySolana() {
  console.log("\n📊 Verifying Solana...");
  
  const result: VerificationResult = {
    chain: "Solana",
    contractAddress: mainnetSolanaConfig.programId,
    exists: false,
  };

  try {
    const rpcUrl = HELIUS_KEY 
      ? "https://mainnet.helius-rpc.com/?api-key=" + HELIUS_KEY
      : "https://api.mainnet-beta.solana.com";
    
    console.log("   Program: " + mainnetSolanaConfig.programId);
    console.log("   Desk: " + mainnetSolanaConfig.desk);
    
    const connection = new Connection(rpcUrl, "confirmed");
    
    // Check program exists
    const programInfo = await connection.getAccountInfo(new PublicKey(mainnetSolanaConfig.programId));
    if (!programInfo) {
      result.error = "Program not deployed";
      results.push(result);
      return;
    }
    
    result.exists = true;
    console.log("   ✅ Program deployed (" + programInfo.data.length + " bytes)");

    // Check desk exists
    const deskPubkey = new PublicKey(mainnetSolanaConfig.desk);
    const deskInfo = await connection.getAccountInfo(deskPubkey);
    if (deskInfo) {
      console.log("   ✅ Desk account exists (" + deskInfo.data.length + " bytes)");
      console.log("   Desk Owner: " + deskInfo.owner.toBase58());
      
      // Parse desk data (first 8 bytes are discriminator)
      // Next 32 bytes is owner pubkey
      const ownerBytes = deskInfo.data.slice(8, 40);
      const owner = new PublicKey(ownerBytes);
      console.log("   Desk Owner Key: " + owner.toBase58());
    }

    // Get desk balance
    const deskBalance = await connection.getBalance(deskPubkey);
    console.log("   Desk SOL Balance: " + (deskBalance / LAMPORTS_PER_SOL));

  } catch (e) {
    result.error = String(e);
    console.log("   ❌ Error: " + e);
  }

  results.push(result);
}

async function main() {
  console.log("═".repeat(70));
  console.log("  ON-CHAIN STATE VERIFICATION");
  console.log("═".repeat(70));

  // Verify Base
  await verifyEvm(
    "Base", 
    base, 
    baseConfig.contracts?.otc as Address || "0x23eD9EC8deb2F88Ec44a2dbbe1bbE7Be7EFc02b9",
    "https://mainnet.base.org"
  );

  // Verify BSC
  if (mainnetEvmConfig.networks?.bsc?.otc) {
    await verifyEvm(
      "BSC",
      bsc,
      mainnetEvmConfig.networks.bsc.otc as Address,
      "https://bsc-dataseed1.binance.org"
    );
  }

  // Verify Ethereum
  if (mainnetEvmConfig.networks?.ethereum?.otc) {
    await verifyEvm(
      "Ethereum",
      mainnet,
      mainnetEvmConfig.networks.ethereum.otc as Address,
      "https://eth.llamarpc.com"
    );
  }

  // Verify Solana
  await verifySolana();

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("  VERIFICATION SUMMARY");
  console.log("═".repeat(70));

  for (const r of results) {
    const status = r.exists ? "✅" : "❌";
    console.log("\n" + status + " " + r.chain);
    console.log("   Contract: " + r.contractAddress);
    if (r.exists) {
      if (r.nextOfferId !== undefined) {
        console.log("   Total Offers Created: " + (r.nextOfferId - 1));
      }
      if (r.p2pOffers !== undefined) {
        console.log("   P2P (Non-Negotiable): " + r.p2pOffers);
      }
      if (r.negotiableOffers !== undefined) {
        console.log("   Negotiable: " + r.negotiableOffers);
      }
      if (r.claimedOffers !== undefined) {
        console.log("   Completed/Claimed: " + r.claimedOffers);
      }
    }
    if (r.error) {
      console.log("   Error: " + r.error);
    }
  }

  const allDeployed = results.every(r => r.exists);
  console.log("\n" + (allDeployed ? "✅ All contracts verified on-chain" : "⚠️ Some contracts missing"));
}

main().catch(console.error);
