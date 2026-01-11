/**
 * Add SOLANA_DESK_PRIVATE_KEY wallet as an approver on the mainnet desk
 * 
 * Run: cd solana/otc-program && npx ts-node scripts/add-desk-approver.ts
 */
import pkg from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import bs58 from "bs58";

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from parent directory
const envPath = path.join(__dirname, "../../../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^#=][^=]*)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

interface AnchorPackage {
  AnchorProvider: {
    env(): {
      connection: { getBalance(pk: PublicKey): Promise<number> };
      wallet: { publicKey: PublicKey };
    };
  };
  setProvider(provider: ReturnType<typeof pkg.AnchorProvider.env>): void;
  workspace: {
    Otc: {
      programId: PublicKey;
      methods: {
        setApprover: (
          who: PublicKey,
          allowed: boolean,
        ) => {
          accounts(accounts: {
            desk: PublicKey;
            owner: PublicKey;
          }): {
            signers(signers: Keypair[]): {
              rpc(options?: { skipPreflight?: boolean }): Promise<string>;
            };
          };
        };
      };
      account: {
        desk: {
          // biome-ignore lint/suspicious/noExplicitAny: Anchor types are dynamic
          fetch(address: PublicKey): Promise<any>;
        };
      };
    };
  };
}

const anchor = pkg as unknown as AnchorPackage;

async function main() {
  console.log("🔧 Adding wallet as approver to desk\n");

  // Set environment for Anchor
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    throw new Error("HELIUS_API_KEY not set in .env");
  }
  process.env.ANCHOR_PROVIDER_URL = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

  // Use SOLANA_PRIVATE_KEY (desk owner) to authorize the transaction
  const ownerPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!ownerPrivateKey) {
    throw new Error("SOLANA_PRIVATE_KEY not set in .env");
  }

  // The wallet we want to add as approver - can be provided as argument or use env var
  const approverAddress = process.argv[2]; // Optional: pass pubkey as argument
  
  // Create keypairs
  const ownerKeypair = Keypair.fromSecretKey(bs58.decode(ownerPrivateKey));
  
  let approverPubkey: PublicKey;
  if (approverAddress) {
    // Use provided pubkey directly
    approverPubkey = new PublicKey(approverAddress);
  } else {
    // Fall back to SOLANA_DESK_PRIVATE_KEY
    const deskPrivateKey = process.env.SOLANA_DESK_PRIVATE_KEY;
    if (!deskPrivateKey) {
      throw new Error("SOLANA_DESK_PRIVATE_KEY not set in .env and no approver address provided");
    }
    const approverKeypair = Keypair.fromSecretKey(bs58.decode(deskPrivateKey));
    approverPubkey = approverKeypair.publicKey;
  }

  // Create temporary wallet file for Anchor
  const tempWalletPath = path.join(__dirname, "../.temp-wallet.json");
  fs.writeFileSync(tempWalletPath, JSON.stringify(Array.from(ownerKeypair.secretKey)));
  process.env.ANCHOR_WALLET = tempWalletPath;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Otc;

  // Desk address from deployment config
  const deskAddress = new PublicKey("12trWAgGB8MmDN7kUYQeZVR1ULzaJHhdDdCLPQE1Rcm6");

  console.log("📋 Program ID:", program.programId.toString());
  console.log("👤 Owner:", ownerKeypair.publicKey.toString());
  console.log("🏦 Desk:", deskAddress.toString());
  console.log("✅ Approver to add:", approverPubkey.toString());

  // Check balance
  const balance = await provider.connection.getBalance(ownerKeypair.publicKey);
  console.log(`💰 Owner balance: ${balance / 1e9} SOL`);

  // Fetch current desk state
  const deskData = await program.account.desk.fetch(deskAddress);
  console.log("\n📊 Current desk state:");
  console.log("   Owner:", deskData.owner.toString());
  console.log("   Agent:", deskData.agent.toString());
  console.log("   Approvers:", deskData.approvers?.length || 0);

  // Verify we're the owner
  if (!deskData.owner.equals(ownerKeypair.publicKey)) {
    throw new Error(`Not the desk owner. Owner is ${deskData.owner.toString()}, we are ${ownerKeypair.publicKey.toString()}`);
  }

  // Check if already an approver
  const isAlreadyApprover = deskData.approvers?.some((a: PublicKey) => a.equals(approverPubkey));
  if (isAlreadyApprover) {
    console.log("\n✅ Wallet is already an approver!");
    fs.unlinkSync(tempWalletPath);
    return;
  }

  console.log("\n⚙️  Adding approver...");

  const tx = await program.methods
    .setApprover(approverPubkey, true)
    .accounts({
      desk: deskAddress,
      owner: ownerKeypair.publicKey,
    })
    .signers([ownerKeypair])
    .rpc({ skipPreflight: false });

  console.log("✅ Approver added. Tx:", tx);
  console.log(`   View on Solscan: https://solscan.io/tx/${tx}`);

  // Clean up temp wallet
  fs.unlinkSync(tempWalletPath);

  // Verify
  console.log("\n📊 Verifying...");
  const newDeskData = await program.account.desk.fetch(deskAddress);
  console.log("   Approvers:", newDeskData.approvers?.length || 0);
  const nowApprover = newDeskData.approvers?.some((a: PublicKey) => a.equals(approverPubkey));
  console.log("   Wallet is approver:", nowApprover);
}

main()
  .then(() => {
    console.log("\n✨ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
