import type { Program, Wallet } from "@coral-xyz/anchor";
import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Otc } from "../target/types/otc";

// ESM/CJS compatibility: import as default then destructure
const { AnchorProvider, setProvider, workspace, BN } = pkg as typeof import("@coral-xyz/anchor");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("🚀 Deploying Solana OTC Desk to Devnet\n");

  // Configure provider from env (ANCHOR_PROVIDER_URL, ANCHOR_WALLET)
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = workspace.Otc as Program<Otc>;

  console.log("📋 Program ID:", program.programId.toString());
  console.log("👤 Payer:", provider.wallet.publicKey.toString());

  // 1. Load or Create Desk Keypair
  const deskKeypairPath = path.join(__dirname, "../desk-devnet-keypair.json");
  let desk: Keypair;
  
  if (fs.existsSync(deskKeypairPath)) {
    const secret = JSON.parse(fs.readFileSync(deskKeypairPath, "utf8"));
    desk = Keypair.fromSecretKey(Uint8Array.from(secret));
    console.log("🏦 Using existing Desk:", desk.publicKey.toString());
  } else {
    desk = Keypair.generate();
    fs.writeFileSync(deskKeypairPath, JSON.stringify(Array.from(desk.secretKey)));
    console.log("🏦 Created new Desk:", desk.publicKey.toString());
  }

  // 2. Create Mints
  console.log("\n🪙 Creating Devnet Mints...");
  // Wallet.payer is optional (only available in Node.js), fallback to loading from file
  const payer = (provider.wallet as Wallet).payer || Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET || "./id.json", "utf8"))));

  // In Devnet, we can't just assume we can create tokens freely if the account is low on SOL
  // But we can try to load existing mints if we saved them
  
  // For this test deployment, we'll create new ones. In prod, these are fixed constants.
  const tokenMint = await createMint(
    provider.connection,
    payer, 
    provider.wallet.publicKey,
    null,
    9
  );
  console.log("✅ Token Mint:", tokenMint.toString());

  const usdcMint = await createMint(
    provider.connection,
    payer,
    provider.wallet.publicKey,
    null,
    6
  );
  console.log("✅ USDC Mint:", usdcMint.toString());

  // 3. Initialize Desk
  try {
    console.log("\n⚙️  Initializing desk...");
    // The program is already deployed (verified in chat history)
    // Now we just need to initialize the data account
    
    const tx = await program.methods
      .initDesk(new BN(500_000_000), new BN(1800))
      .accountsPartial({
        payer: provider.wallet.publicKey,
        owner: provider.wallet.publicKey,
        agent: provider.wallet.publicKey, 
        tokenMint: tokenMint,
        usdcMint: usdcMint,
        desk: desk.publicKey,
      })
      .signers([desk]) // Desk must sign to prove ownership of PDA? No, init needs system account signers usually for new accounts
      // Wait, if desk is a Keypair account being initialized:
      // #[account(init, payer = payer, space = 8 + Desk::SIZE)] pub desk: Account<'info, Desk>,
      // Then yes, desk keypair must sign.
      .rpc();
      
    console.log("✅ Desk initialized. Tx:", tx);
  } catch (e: unknown) {
    const error = e as Error & { logs?: string[] };
    console.log("⚠️  Desk init error (might be already initialized):", error.message);
    if (error.logs) console.log("Logs:", error.logs);
  }

  // 4. Config Output
  const envData = {
    NEXT_PUBLIC_SOLANA_RPC: "https://api.devnet.solana.com",
    NEXT_PUBLIC_SOLANA_PROGRAM_ID: program.programId.toString(),
    NEXT_PUBLIC_SOLANA_DESK: desk.publicKey.toString(),
    NEXT_PUBLIC_SOLANA_DESK_OWNER: provider.wallet.publicKey.toString(),
    NEXT_PUBLIC_SOLANA_TOKEN_MINT: tokenMint.toString(),
    NEXT_PUBLIC_SOLANA_USDC_MINT: usdcMint.toString(),
  };

  // Ensure dir exists
  const deploymentPath = path.join(__dirname, "../../../src/config/deployments/testnet-solana.json");
  const deploymentDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(envData, null, 2));
  console.log(`\n✅ Config saved to ${deploymentPath}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
