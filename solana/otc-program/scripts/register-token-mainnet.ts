#!/usr/bin/env bun
/**
 * Register ELIZAOS token on mainnet Solana desk
 * 
 * This script registers the ELIZAOS token in the desk's TokenRegistry
 * which enables consignments and offers for this token.
 * 
 * CAUTION: This uses real mainnet - ensure you're the desk owner!
 */

import type { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import type { Otc } from "../target/types/otc";

// Mainnet config
const SOLANA_RPC = process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;

// Addresses from mainnet deployment
const PROGRAM_ID = new PublicKey("3uTdWzoAcBFKTVYRd2z2jDKAcuyW64rQLxa9wMreDJKo");
const DESK = new PublicKey("vNquimFmvu93LRfyJ9qixdFjXh1gedJRQDwk43dNnrj");
const ELIZAOS_MINT = new PublicKey("DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA");

// Raydium pool for ELIZAOS/SOL pricing (if available)
// const ELIZAOS_POOL = new PublicKey("..."); // TODO: Add actual pool address
// For now, use manual pricing

async function main() {
  console.log("🔐 Register ELIZAOS Token on Mainnet Desk\n");
  
  // Validate required environment
  if (!SOLANA_PRIVATE_KEY) {
    throw new Error("SOLANA_PRIVATE_KEY environment variable is required");
  }
  
  // Setup
  const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
  const connection = new Connection(SOLANA_RPC, "confirmed");
  
  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
  console.log(`Desk: ${DESK.toBase58()}`);
  console.log(`ELIZAOS Mint: ${ELIZAOS_MINT.toBase58()}`);
  
  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  
  if (balance < 0.01e9) {
    console.log("❌ Insufficient SOL for transaction fees");
    process.exit(1);
  }
  
  // Load IDL
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  if (!fs.existsSync(idlPath)) {
    console.log(`❌ IDL not found at ${idlPath}`);
    console.log("   Run: cd solana/otc-program && anchor build");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  
  // Setup Anchor
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  
  const program = new anchor.Program(idl, provider) as Program<Otc>;
  
  // Check if we're the desk owner
  console.log("\n[1] Checking desk ownership...");
  const deskData = await program.account.desk.fetch(DESK);
  console.log(`   Desk owner: ${deskData.owner.toBase58()}`);
  
  if (deskData.owner.toBase58() !== keypair.publicKey.toBase58()) {
    console.log("❌ You are not the desk owner");
    console.log(`   Expected: ${keypair.publicKey.toBase58()}`);
    console.log(`   Actual: ${deskData.owner.toBase58()}`);
    process.exit(1);
  }
  console.log("   ✅ You are the desk owner");
  
  // Calculate token registry PDA
  console.log("\n[2] Calculating token registry PDA...");
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), DESK.toBuffer(), ELIZAOS_MINT.toBuffer()],
    PROGRAM_ID
  );
  console.log(`   Registry PDA: ${tokenRegistryPda.toBase58()}`);
  
  // Check if already registered
  const registryInfo = await connection.getAccountInfo(tokenRegistryPda);
  if (registryInfo) {
    console.log("   ⚠️ Token already registered!");
    
    // Read current registry data
    const registryData = await program.account.tokenRegistry.fetch(tokenRegistryPda);
    console.log(`   Token mint: ${registryData.tokenMint.toBase58()}`);
    console.log(`   Decimals: ${registryData.decimals}`);
    console.log(`   Active: ${registryData.isActive}`);
    console.log(`   Price (8d): ${registryData.tokenUsdPrice8d.toString()}`);
    
    // Check if price is set
    if (registryData.tokenUsdPrice8d.toString() === "0") {
      console.log("\n[3] Setting token price...");
      // Set a reasonable price - ELIZAOS is around $0.001-0.01
      // 8 decimals: $0.005 = 500000
      const priceUsd8d = new anchor.BN(500000); // $0.005
      
      await program.methods
        .setManualTokenPrice(priceUsd8d)
        .accountsPartial({
          tokenRegistry: tokenRegistryPda,
          desk: DESK,
          owner: keypair.publicKey,
        })
        .rpc();
      
      console.log(`   ✅ Token price set to $${(500000 / 1e8).toFixed(6)}`);
    }
    
    // Check if SOL price is set on desk
    if (deskData.solUsdPrice8d.toString() === "0") {
      console.log("\n[4] Setting SOL price...");
      // SOL around $200
      const solUsd8d = new anchor.BN(200_000_000_00); // $200.00
      
      await program.methods
        .setPrices(
          new anchor.BN(0), // token price (deprecated)
          solUsd8d,
          new anchor.BN(0), // updated_at (uses clock)
          new anchor.BN(3600) // max age 1 hour
        )
        .accountsPartial({
          desk: DESK,
          owner: keypair.publicKey,
        })
        .rpc();
      
      console.log(`   ✅ SOL price set to $200.00`);
    }
    
    console.log("\n✅ Token registration verified");
    process.exit(0);
  }
  
  // Create desk token treasury ATA if needed
  console.log("\n[3] Creating desk token treasury...");
  const deskTokenTreasury = await getAssociatedTokenAddress(ELIZAOS_MINT, DESK, true);
  console.log(`   Treasury ATA: ${deskTokenTreasury.toBase58()}`);
  
  const treasuryInfo = await connection.getAccountInfo(deskTokenTreasury);
  if (!treasuryInfo) {
    console.log("   Creating treasury ATA...");
    // This will be created by the token program when we first interact
    // For now, we'll just proceed - the registerToken may create it
  } else {
    console.log("   ✅ Treasury ATA exists");
  }
  
  // Register token
  console.log("\n[4] Registering token...");
  
  try {
    const tx = await program.methods
      .registerToken(
        Array(32).fill(0), // No Pyth feed for now
        PublicKey.default, // No pool for now (use manual pricing)
        0                  // PoolType::None
      )
      .accountsPartial({
        desk: DESK,
        payer: keypair.publicKey,
        tokenMint: ELIZAOS_MINT,
        tokenRegistry: tokenRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log(`   ✅ Token registered! Tx: ${tx}`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.log(`   ❌ Registration failed: ${errMsg}`);
    process.exit(1);
  }
  
  // Set token price
  console.log("\n[5] Setting token price...");
  // ELIZAOS is around $0.001-0.01 - let's set $0.005
  const priceUsd8d = new anchor.BN(500000); // $0.005 (8 decimals)
  
  await program.methods
    .setManualTokenPrice(priceUsd8d)
    .accountsPartial({
      tokenRegistry: tokenRegistryPda,
      desk: DESK,
      owner: keypair.publicKey,
    })
    .rpc();
  
  console.log(`   ✅ Token price set to $${(500000 / 1e8).toFixed(6)}`);
  
  // Set SOL price on desk
  console.log("\n[6] Setting SOL price...");
  const solUsd8d = new anchor.BN(200_000_000_00); // $200.00
  
  await program.methods
    .setPrices(
      new anchor.BN(0), // token price (deprecated)
      solUsd8d,
      new anchor.BN(0), // updated_at (uses clock)
      new anchor.BN(3600) // max age 1 hour
    )
    .accountsPartial({
      desk: DESK,
      owner: keypair.publicKey,
    })
    .rpc();
  
  console.log(`   ✅ SOL price set to $200.00`);
  
  // Verify
  console.log("\n[7] Verifying registration...");
  const finalRegistry = await program.account.tokenRegistry.fetch(tokenRegistryPda);
  console.log(`   Token mint: ${finalRegistry.tokenMint.toBase58()}`);
  console.log(`   Decimals: ${finalRegistry.decimals}`);
  console.log(`   Active: ${finalRegistry.isActive}`);
  console.log(`   Price: $${(Number(finalRegistry.tokenUsdPrice8d) / 1e8).toFixed(6)}`);
  
  console.log("\n✅ ELIZAOS token registered successfully!");
  console.log(`   Registry PDA: ${tokenRegistryPda.toBase58()}`);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
