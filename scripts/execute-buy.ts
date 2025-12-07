/**
 * Execute a real buy on Solana mainnet
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== EXECUTING REAL BUY ON SOLANA MAINNET ===\n");

  // Setup
  const rpc = process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  // Load wallet
  const privateKey = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKey) throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set");

  let keypairBytes: Uint8Array;
  if (privateKey.startsWith("[")) {
    keypairBytes = Uint8Array.from(JSON.parse(privateKey));
  } else {
    const bs58 = await import("bs58").then(m => m.default);
    keypairBytes = bs58.decode(privateKey);
  }
  const wallet = Keypair.fromSecretKey(keypairBytes);
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`SOL Balance: ${balance / 1e9} SOL`);

  // Load program
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  
  const anchorWallet = new anchor.Wallet(wallet);
  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID || "6qn8ELVXd957oRjLaomCpKpcVZshUjNvSzw1nc7QVyXc");
  let program: anchor.Program;
  try {
    program = new anchor.Program(idl, provider);
  } catch {
    program = new anchor.Program(idl, programId, provider) as anchor.Program;
  }

  // Get desk
  const desk = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_DESK_MAINNET || "G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU");
  const tokenMint = new PublicKey("DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA");
  
  console.log(`Desk: ${desk.toBase58()}`);
  console.log(`Token: ${tokenMint.toBase58()}`);

  // Derive accounts
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
    programId
  );
  const deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, desk, true);
  
  console.log(`Token Registry: ${tokenRegistryPda.toBase58()}`);
  console.log(`Treasury: ${deskTokenTreasury.toBase58()}`);

  // Check treasury balance
  const treasuryBalance = await connection.getTokenAccountBalance(deskTokenTreasury);
  console.log(`Treasury Balance: ${treasuryBalance.value.uiAmountString} ELIZAOS\n`);

  // Try buying 3 tokens (all we have) at $0.05 each = $0.15
  // If min USD is higher, this will fail but we'll get a better error message
  const buyAmountTokens = 3; // 3 tokens
  const buyAmount = new anchor.BN(buyAmountTokens * 1e9); // in smallest units (9 decimals)
  
  console.log("=== CREATING BUY OFFER ===");
  console.log(`Amount: ${buyAmountTokens} ELIZAOS tokens`);
  console.log(`Price: $0.05 per token`);
  console.log(`Total Value: $${buyAmountTokens * 0.05}`);
  console.log(`Discount: 10%`);
  console.log(`Lockup: 30 days`);

  const offerKeypair = Keypair.generate();
  console.log(`\nOffer Account: ${offerKeypair.publicKey.toBase58()}`);

  try {
    const tx = await (program as anchor.Program).methods
      .createOffer(
        buyAmount,
        1000, // 10% discount (1000 bps)
        0, // SOL payment type
        new anchor.BN(30 * 24 * 60 * 60) // 30 day lockup in seconds
      )
      .accountsStrict({
        desk: desk,
        tokenRegistry: tokenRegistryPda,
        deskTokenTreasury: deskTokenTreasury,
        beneficiary: wallet.publicKey,
        offer: offerKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet, offerKeypair])
      .rpc();

    console.log(`\n✅ BUY OFFER CREATED ON MAINNET`);
    console.log(`Transaction: ${tx}`);
    console.log(`Offer Account: ${offerKeypair.publicKey.toBase58()}`);
    console.log(`\nView on Solscan: https://solscan.io/tx/${tx}`);

    // Wait and verify
    console.log("\n=== VERIFYING OFFER ON-CHAIN ===");
    await new Promise(r => setTimeout(r, 3000));
    
    const offerInfo = await connection.getAccountInfo(offerKeypair.publicKey);
    if (offerInfo) {
      console.log(`✅ Offer account exists on-chain`);
      console.log(`   Size: ${offerInfo.data.length} bytes`);
      console.log(`   Owner: ${offerInfo.owner.toBase58()}`);
    } else {
      console.log(`❌ Offer account not found`);
    }

  } catch (e) {
    console.log(`\n❌ Error:`, e);
    
    // Try to extract the error code
    const errorMatch = String(e).match(/Error Code: (\w+)/);
    if (errorMatch) {
      console.log(`\nError Code: ${errorMatch[1]}`);
      if (errorMatch[1] === "MinUsd") {
        console.log("The minimum USD requirement was not met.");
        console.log("The desk requires a larger purchase amount.");
      }
    }
  }
}

main().catch(console.error);

