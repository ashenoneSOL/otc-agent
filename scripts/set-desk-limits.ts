/**
 * Set desk limits on Solana mainnet
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== SETTING DESK LIMITS ON MAINNET ===\n");

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
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

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

  const desk = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_DESK_MAINNET || "G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU");
  console.log(`Desk: ${desk.toBase58()}`);

  // Set new limits
  // min_usd_amount_8d: $0.01 = 1000000 (8 decimals)
  // max_token_per_order: 1000000000000 (1000 tokens with 9 decimals)
  // quote_expiry_secs: 3600 (1 hour)
  // default_unlock_delay_secs: 0 (no delay)
  // max_lockup_secs: 365 * 24 * 60 * 60 (1 year)
  
  const minUsd8d = new anchor.BN(1000000); // $0.01
  const maxTokenPerOrder = new anchor.BN("1000000000000"); // 1000 tokens
  const quoteExpirySecs = new anchor.BN(3600); // 1 hour
  const defaultUnlockDelaySecs = new anchor.BN(0);
  const maxLockupSecs = new anchor.BN(365 * 24 * 60 * 60); // 1 year

  console.log("\nNew limits:");
  console.log(`  Min USD: $${Number(minUsd8d) / 1e8}`);
  console.log(`  Max Token Per Order: ${Number(maxTokenPerOrder) / 1e9} tokens`);
  console.log(`  Quote Expiry: ${quoteExpirySecs.toString()} seconds`);
  console.log(`  Default Unlock Delay: ${defaultUnlockDelaySecs.toString()} seconds`);
  console.log(`  Max Lockup: ${maxLockupSecs.toString()} seconds`);

  console.log("\nSetting limits...");

  try {
    const tx = await (program as anchor.Program).methods
      .setLimits(
        minUsd8d,
        maxTokenPerOrder,
        quoteExpirySecs,
        defaultUnlockDelaySecs,
        maxLockupSecs
      )
      .accounts({
        owner: wallet.publicKey,
        desk: desk,
      })
      .signers([wallet])
      .rpc();

    console.log(`\n✅ Limits set`);
    console.log(`Transaction: ${tx}`);
    console.log(`View on Solscan: https://solscan.io/tx/${tx}`);
  } catch (e) {
    console.log(`\n❌ Error:`, e);
  }
}

main().catch(console.error);

