/**
 * Check desk state and execute a real buy
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== CHECKING DESK STATE AND EXECUTING BUY ===\n");

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

  // Get desk
  const desk = new PublicKey(process.env.NEXT_PUBLIC_SOLANA_DESK_MAINNET || "G89QsVcKN1MZe6d8eKyzv93u7TEeXSsXbsDsBPbuTMUU");
  console.log(`Desk: ${desk.toBase58()}`);

  // Fetch desk state
  type DeskAccount = {
    minUsdAmount8d: anchor.BN;
    maxUsdAmount8d: anchor.BN;
    nextOfferId: anchor.BN;
    isPaused: boolean;
    solPriceUsd8d: anchor.BN;
  };
  
  const deskAccount = await (program.account as { desk: { fetch: (addr: PublicKey) => Promise<DeskAccount> } }).desk.fetch(desk);
  
  console.log("\n=== DESK STATE ===");
  console.log(`Min USD: $${Number(deskAccount.minUsdAmount8d) / 1e8}`);
  console.log(`Max USD: $${Number(deskAccount.maxUsdAmount8d) / 1e8}`);
  console.log(`Next Offer ID: ${deskAccount.nextOfferId.toString()}`);
  console.log(`Paused: ${deskAccount.isPaused}`);
  console.log(`SOL Price: $${Number(deskAccount.solPriceUsd8d) / 1e8}`);

  // Token info
  const tokenMint = new PublicKey("DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA");
  const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
    programId
  );

  type TokenRegistry = {
    priceUsd8d: anchor.BN;
    isActive: boolean;
  };
  
  const tokenRegistry = await (program.account as { tokenRegistry: { fetch: (addr: PublicKey) => Promise<TokenRegistry> } }).tokenRegistry.fetch(tokenRegistryPda);
  console.log("\n=== TOKEN STATE ===");
  console.log(`Token Price: $${Number(tokenRegistry.priceUsd8d) / 1e8}`);
  console.log(`Active: ${tokenRegistry.isActive}`);

  // Calculate required amount
  const minUsd = Number(deskAccount.minUsdAmount8d) / 1e8;
  const tokenPrice = Number(tokenRegistry.priceUsd8d) / 1e8;
  const requiredTokens = Math.ceil(minUsd / tokenPrice);
  
  console.log("\n=== CALCULATION ===");
  console.log(`Min USD required: $${minUsd}`);
  console.log(`Token price: $${tokenPrice}`);
  console.log(`Required tokens: ${requiredTokens}`);

  // Check treasury balance
  const deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, desk, true);
  const treasuryBalance = await connection.getTokenAccountBalance(deskTokenTreasury);
  console.log(`Treasury balance: ${treasuryBalance.value.uiAmountString} ELIZAOS`);

  const treasuryTokens = Number(treasuryBalance.value.amount) / 1e9;
  
  if (treasuryTokens < requiredTokens) {
    console.log(`\n⚠️ Not enough tokens in treasury. Need ${requiredTokens}, have ${treasuryTokens}`);
    console.log("Cannot create buy offer - need more tokens listed first.");
    return;
  }

  // Create buy offer
  console.log("\n=== CREATING BUY OFFER ===");
  
  const buyAmount = new anchor.BN(requiredTokens * 1e9); // tokens in lamports
  const offerKeypair = Keypair.generate();
  
  console.log(`Amount: ${requiredTokens} tokens`);
  console.log(`Discount: 10%`);
  console.log(`Lockup: 30 days`);
  console.log(`Offer account: ${offerKeypair.publicKey.toBase58()}`);

  try {
    const tx = await (program as anchor.Program).methods
      .createOffer(
        buyAmount,
        1000, // 10% discount
        0, // SOL payment
        new anchor.BN(30 * 24 * 60 * 60) // 30 day lockup
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

    console.log(`\n✅ BUY OFFER CREATED`);
    console.log(`Transaction: ${tx}`);
    console.log(`Offer: ${offerKeypair.publicKey.toBase58()}`);
    console.log(`View on Solscan: https://solscan.io/tx/${tx}`);

    // Verify offer
    console.log("\n=== VERIFYING OFFER ===");
    type OfferAccount = {
      approved: boolean;
      paid: boolean;
      beneficiary: PublicKey;
      tokenAmount: anchor.BN;
    };
    const offerState = await (program.account as { offer: { fetch: (addr: PublicKey) => Promise<OfferAccount> } }).offer.fetch(offerKeypair.publicKey);
    console.log(`Beneficiary: ${offerState.beneficiary.toBase58()}`);
    console.log(`Token Amount: ${Number(offerState.tokenAmount) / 1e9}`);
    console.log(`Approved: ${offerState.approved}`);
    console.log(`Paid: ${offerState.paid}`);

  } catch (e) {
    console.log(`\n❌ Error creating offer:`, e);
  }
}

main().catch(console.error);

