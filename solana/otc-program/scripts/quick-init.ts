import type { Program } from "@coral-xyz/anchor";
import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import { fileURLToPath } from "url";
import * as path from "path";
import type { Otc } from "../target/types/otc";

// ESM/CJS compatibility: import as default then destructure
const { AnchorProvider, setProvider, workspace, BN } = pkg as typeof import("@coral-xyz/anchor");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Quick Solana OTC Desk Setup\n");

  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = workspace.Otc as Program<Otc>;

  console.log("📋 Program ID:", program.programId.toString());

  // Load owner keypair
  const ownerData = JSON.parse(fs.readFileSync("./id.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(ownerData));
  console.log("👤 Owner:", owner.publicKey.toString());

  // Check balance
  let balance = await provider.connection.getBalance(owner.publicKey);
  console.log(`💰 Owner balance: ${balance / 1e9} SOL`);

  if (balance < 3e9) {
    console.log("💸 Airdropping SOL...");
    const sig = await provider.connection.requestAirdrop(owner.publicKey, 5e9);
    await provider.connection.confirmTransaction(sig, "confirmed");
    balance = await provider.connection.getBalance(owner.publicKey);
    console.log(`💰 New balance: ${balance / 1e9} SOL`);
  }

  // Generate agent and desk keypairs
  const agent = Keypair.generate();
  const agentSig = await provider.connection.requestAirdrop(
    agent.publicKey,
    1e9
  );
  await provider.connection.confirmTransaction(agentSig, "confirmed");
  console.log("🤖 Agent:", agent.publicKey.toString());

  const desk = Keypair.generate();
  console.log("🏦 Desk (keypair):", desk.publicKey.toString());

  // Create token mints
  console.log("\n🪙 Creating token mints...");
  console.log("⚠️  NOTE: Using 9 decimals for native Solana token (standard)");
  
  const tokenMint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    null,
    9  // ⚠️ CRITICAL: This determines decimals on BOTH chains when bridging via CCIP
  );
  console.log("✅ Token Mint:", tokenMint.toString());

  const usdcMint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    null,
    6
  );
  console.log("✅ USDC Mint:", usdcMint.toString());

  // Create token accounts for desk
  console.log("\n📦 Creating desk token accounts...");
  const deskTokenAta = getAssociatedTokenAddressSync(
    tokenMint,
    desk.publicKey,
    true
  );
  const deskUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    desk.publicKey,
    true
  );

  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    tokenMint,
    desk.publicKey,
    true
  );
  console.log("✅ Desk token ATA:", deskTokenAta.toString());

  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    usdcMint,
    desk.publicKey,
    true
  );
  console.log("✅ Desk USDC ATA:", deskUsdcAta.toString());

  // Initialize desk using PDA
  console.log("\n⚙️  Initializing desk...");
  const tx = await program.methods
    .initDesk(
      new BN(500_000_000),
      new BN(1800)
    )
    .accountsPartial({
      payer: owner.publicKey,
      owner: owner.publicKey,
      agent: agent.publicKey,
      tokenMint: tokenMint,
      usdcMint: usdcMint,
      desk: desk.publicKey,
    })
    .signers([owner, desk]) // Both owner and desk sign
    .rpc();

  console.log("✅ Desk initialized! Tx:", tx);

  // Set prices
  console.log("\n💲 Setting prices...");
  await program.methods
    .setPrices(
      new BN(1_000_000_000),
      new BN(100_000_000_00),
      new BN(0),
      new BN(3600)
    )
    .accountsPartial({ desk: desk.publicKey, owner: owner.publicKey })
    .signers([owner])
    .rpc();
  console.log("✅ Prices set");

  // Add owner as approver
  console.log("\n👤 Adding owner as approver...");
  await program.methods
    .setApprover(owner.publicKey, true)
    .accountsPartial({ desk: desk.publicKey, owner: owner.publicKey })
    .signers([owner])
    .rpc();
  console.log("✅ Owner added as approver");

  // Mint tokens to owner
  console.log("\n💎 Minting tokens...");
  const ownerTokenAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    tokenMint,
    owner.publicKey
  );

  await mintTo(
    provider.connection,
    owner,
    tokenMint,
    ownerTokenAta.address,
    owner,
    1_000_000_000_000_000
  );
  console.log("✅ Minted 1,000,000 tokens to owner");

  // Deposit to desk
  console.log("\n📥 Depositing tokens to desk...");
  await program.methods
    .depositTokens(new BN("500000000000000"))
    .accountsPartial({
      desk: desk.publicKey,
      owner: owner.publicKey,
      ownerTokenAta: ownerTokenAta.address,
      deskTokenTreasury: deskTokenAta,
    })
    .signers([owner])
    .rpc();
  console.log("✅ Deposited 500,000 tokens");

  // Save desk keypair
  const deskKeypairPath = path.join(__dirname, "../desk-keypair.json");
  fs.writeFileSync(deskKeypairPath, JSON.stringify(Array.from(desk.secretKey)));
  console.log("\n💾 Saved desk keypair to:", deskKeypairPath);

  // Output for .env
  console.log("\n" + "=".repeat(80));
  console.log("🎉 SUCCESS! Update your .env.local with these values:");
  console.log("=".repeat(80));
  console.log(`NEXT_PUBLIC_SOLANA_RPC=http://127.0.0.1:8899`);
  console.log(`NEXT_PUBLIC_SOLANA_PROGRAM_ID=${program.programId.toString()}`);
  console.log(`NEXT_PUBLIC_SOLANA_DESK=${desk.publicKey.toString()}`);
  console.log(`NEXT_PUBLIC_SOLANA_DESK_OWNER=${owner.publicKey.toString()}`);
  console.log(`NEXT_PUBLIC_SOLANA_TOKEN_MINT=${tokenMint.toString()}`);
  console.log(`NEXT_PUBLIC_SOLANA_USDC_MINT=${usdcMint.toString()}`);
  console.log("=".repeat(80));

  // Write to src config
  const deploymentPath = path.join(__dirname, "../../../src/config/deployments/local-solana.json");
  const deploymentDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const envData = {
    NEXT_PUBLIC_SOLANA_RPC: "http://127.0.0.1:8899",
    NEXT_PUBLIC_SOLANA_PROGRAM_ID: program.programId.toString(),
    NEXT_PUBLIC_SOLANA_DESK: desk.publicKey.toString(),
    NEXT_PUBLIC_SOLANA_DESK_OWNER: owner.publicKey.toString(),
    NEXT_PUBLIC_SOLANA_TOKEN_MINT: tokenMint.toString(),
    NEXT_PUBLIC_SOLANA_USDC_MINT: usdcMint.toString(),
  };
  
  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(envData, null, 2)
  );
  console.log(`\n✅ Config saved to ${deploymentPath}`);

  // Update .env.local
  const envLocalPath = path.join(__dirname, "../../../.env.local");
  let envContent = "";
  try {
    envContent = fs.readFileSync(envLocalPath, "utf8");
  } catch (e) {
    // File might not exist
  }

  let newEnvContent = envContent;
  for (const [key, value] of Object.entries(envData)) {
    const regex = new RegExp(`^${key}=.*`, "m");
    if (regex.test(newEnvContent)) {
      newEnvContent = newEnvContent.replace(regex, `${key}=${value}`);
    } else {
      newEnvContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envLocalPath, newEnvContent);
  console.log(`✅ Updated .env.local`);
}

main()
  .then(() => {
    console.log("\n✨ All done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
