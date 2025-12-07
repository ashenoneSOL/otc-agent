/**
 * Set Manual Token Price on Solana Mainnet
 * 
 * Usage: bun scripts/set-token-price.ts <TOKEN_MINT> <PRICE_USD>
 * Example: bun scripts/set-token-price.ts DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA 0.05
 */

import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const tokenMintArg = process.argv[2];
  const priceUsdArg = process.argv[3];

  if (!tokenMintArg || !priceUsdArg) {
    console.log("Usage: bun scripts/set-token-price.ts <TOKEN_MINT> <PRICE_USD>");
    console.log("Example: bun scripts/set-token-price.ts DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA 0.05");
    process.exit(1);
  }

  const tokenMint = new PublicKey(tokenMintArg);
  const priceUsd = parseFloat(priceUsdArg);
  
  // Convert to 8 decimal fixed point (price_8d)
  const price8d = new anchor.BN(Math.floor(priceUsd * 1e8));

  console.log("=== SETTING TOKEN PRICE ON MAINNET ===\n");
  console.log(`Token: ${tokenMint.toBase58()}`);
  console.log(`Price: $${priceUsd} (${price8d.toString()} in 8d format)`);

  // Load wallet
  const privateKey = process.env.SOLANA_MAINNET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SOLANA_MAINNET_PRIVATE_KEY not set");
  }

  let keypairBytes: Uint8Array;
  if (privateKey.startsWith("[")) {
    keypairBytes = Uint8Array.from(JSON.parse(privateKey));
  } else {
    const bs58 = await import("bs58").then(m => m.default);
    keypairBytes = bs58.decode(privateKey);
  }
  const wallet = Keypair.fromSecretKey(keypairBytes);

  console.log(`\nWallet: ${wallet.publicKey.toBase58()}`);

  // Setup connection
  const rpc = process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  // Load program
  const idlPath = path.join(process.cwd(), "solana/otc-program/target/idl/otc.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  
  const anchorWallet = new anchor.Wallet(wallet);
  const provider = new anchor.AnchorProvider(connection, anchorWallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const programId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID || "6qn8ELVXd957oRjLaomCpKpcVZshUjNvSzw1nc7QVyXc";
  let program: anchor.Program;
  try {
    program = new anchor.Program(idl, provider);
  } catch {
    program = new anchor.Program(idl, new PublicKey(programId), provider) as anchor.Program;
  }

  // Get desk address
  const desk = new PublicKey(
    process.env.NEXT_PUBLIC_SOLANA_DESK_MAINNET || 
    process.env.NEXT_PUBLIC_SOLANA_DESK ||
    "G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU"
  );

  // Derive token registry PDA
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
    program.programId
  );

  console.log(`Desk: ${desk.toBase58()}`);
  console.log(`Token Registry: ${tokenRegistryPda.toBase58()}`);

  console.log("\nSetting price...");

  const tx = await (program as anchor.Program).methods
    .setManualTokenPrice(price8d)
    .accounts({
      tokenRegistry: tokenRegistryPda,
      desk: desk,
      owner: wallet.publicKey,
    })
    .signers([wallet])
    .rpc();

  console.log(`\n✅ Price set`);
  console.log(`Transaction: ${tx}`);
  console.log(`View on Solscan: https://solscan.io/tx/${tx}`);
}

main().catch(console.error);

