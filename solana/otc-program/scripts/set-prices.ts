import pkg from "@coral-xyz/anchor";
const anchor: any = pkg as any;
const { BN } = anchor;
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setPrices() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  // Load IDL directly instead of using workspace
  const idlPath = path.join(__dirname, "..", "target", "idl", "otc.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run: anchor build`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  
  // Get program ID - try deployed keypair first, then IDL address, then Anchor.toml default
  let deployedProgramId: PublicKey;
  const deployKeypairPath = path.join(__dirname, "..", "target", "deploy", "otc-keypair.json");
  if (fs.existsSync(deployKeypairPath)) {
    const deployKeypairData = JSON.parse(fs.readFileSync(deployKeypairPath, "utf8"));
    const deployKeypair = Keypair.fromSecretKey(Uint8Array.from(deployKeypairData));
    deployedProgramId = deployKeypair.publicKey;
  } else {
    deployedProgramId = new PublicKey(idl.address || idl.metadata?.address || "8X2wDShtcJ5mFrcsJPjK8tQCD16zBqzsUGwhSCM4ggko");
  }
  
  // Update IDL metadata address to match deployed program (don't mutate, create new object)
  const idlWithCorrectAddress = {
    ...idl,
    metadata: {
      ...idl.metadata,
      address: deployedProgramId.toString(),
    },
  };
  
  // Create program - use IDL with correct address, same pattern as other scripts
  const program = new (anchor as any).Program(idlWithCorrectAddress, provider);
  
  const ownerData = JSON.parse(fs.readFileSync("./id.json", "utf8"));
  const owner = Keypair.fromSecretKey(Uint8Array.from(ownerData));
  const desk = new PublicKey("7EN1rubej95WmoyupRXQ78PKU2hTCspKn2mVKN1vxuPp");
  
  // Check if Solana validator is running
  try {
    await provider.connection.getSlot();
  } catch (error: any) {
    throw new Error(`Solana validator is not running. Start it with: bun run dev`);
  }
  
  // Check if program is deployed
  const programId = program.programId;
  try {
    const programInfo = await provider.connection.getAccountInfo(programId);
    if (!programInfo) {
      throw new Error(`Program ${programId.toString()} is not deployed. Deploy it first with: bun run sol:deploy`);
    }
  } catch (error: any) {
    if (error.message?.includes("not deployed")) {
      throw error;
    }
    // Re-throw connection errors
    throw error;
  }
  
  // Check balance and airdrop if needed
  const balance = await provider.connection.getBalance(owner.publicKey);
  const minBalance = 0.1 * 1e9; // 0.1 SOL
  if (balance < minBalance) {
    console.log(`💰 Wallet balance: ${balance / 1e9} SOL - requesting airdrop...`);
    const sig = await provider.connection.requestAirdrop(owner.publicKey, 2 * 1e9); // 2 SOL
    await provider.connection.confirmTransaction(sig, "confirmed");
    const newBalance = await provider.connection.getBalance(owner.publicKey);
    console.log(`✅ Airdropped! New balance: ${newBalance / 1e9} SOL`);
  }
  
  console.log("💲 Setting prices on desk:", desk.toString());
  console.log("   Token: $1.00");
  console.log("   SOL: $100.00");
  
  const tx = await program.methods
    .setPrices(
      new BN(100_000_000), // $1.00 token (8 decimals: 1.00 * 10^8)
      new BN(10_000_000_000), // $100 SOL (8 decimals: 100 * 10^8)
      new BN(0),
      new BN(3600) // 1 hour max age
    )
    .accounts({
      desk,
      owner: owner.publicKey,
    })
    .signers([owner])
    .rpc();
  
  console.log("✅ Prices set successfully");
  console.log("   Transaction:", tx);
  
  // Verify
  const updated = await program.account.desk.fetch(desk);
  console.log("\n📊 Verified:");
  console.log("   Token USD Price:", updated.tokenUsdPrice8d?.toString());
  console.log("   SOL USD Price:", updated.solUsdPrice8d?.toString());
}

setPrices()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
