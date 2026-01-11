/**
 * Set minimum USD to near-zero for testing low-value transactions
 * 
 * This script calls set_limits to lower min_usd_amount_8d from $5 to $0.01
 * so we can test with small token amounts.
 * 
 * Run: cd solana/otc-program && npx ts-node scripts/set-min-usd-zero.ts
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
        setLimits: (
          minUsdAmount8d: { toString(): string },
          maxTokenPerOrder: { toString(): string },
          quoteExpirySecs: { toString(): string },
          defaultUnlockDelaySecs: { toString(): string },
          maxLockupSecs: { toString(): string },
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
          fetch(address: PublicKey): Promise<{
            owner: PublicKey;
            minUsdAmount8d: { toString(): string };
            maxTokenPerOrder: { toString(): string };
            quoteExpirySecs: { toString(): string };
            defaultUnlockDelaySecs: { toString(): string };
            maxLockupSecs: { toString(): string };
          }>;
        };
      };
    };
  };
  BN: new (value: string | number) => { toString(): string };
}

const anchor = pkg as unknown as AnchorPackage;
const { BN } = anchor;

// Load .env from parent directory
const envPath = path.join(__dirname, "../../../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

async function main() {
  console.log("🔧 Setting minimum USD threshold to near-zero\n");

  // Set environment for Anchor
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    throw new Error("HELIUS_API_KEY not set in .env");
  }
  process.env.ANCHOR_PROVIDER_URL = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  
  // Use SOLANA_PRIVATE_KEY from .env (this is the desk owner)
  const ownerPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!ownerPrivateKey) {
    throw new Error("SOLANA_PRIVATE_KEY not set in .env");
  }
  const deskPrivateKey = ownerPrivateKey;
  
  // Create temporary wallet file for Anchor
  const ownerKeypair = Keypair.fromSecretKey(bs58.decode(deskPrivateKey));
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

  // Check balance
  const balance = await provider.connection.getBalance(ownerKeypair.publicKey);
  console.log(`💰 Owner balance: ${balance / 1e9} SOL`);

  // Fetch current desk state
  console.log("\n📊 Current desk limits:");
  // biome-ignore lint/suspicious/noExplicitAny: Anchor types are dynamic
  const deskData = await program.account.desk.fetch(deskAddress) as any;
  console.log("Raw desk data keys:", Object.keys(deskData));
  
  // Handle various field naming conventions
  const minUsd = deskData.minUsdAmount8D || deskData.minUsdAmount8d || deskData.min_usd_amount_8d;
  const maxToken = deskData.maxTokenPerOrder || deskData.max_token_per_order;
  const quoteExpiry = deskData.quoteExpirySecs || deskData.quote_expiry_secs;
  const unlockDelay = deskData.defaultUnlockDelaySecs || deskData.default_unlock_delay_secs;
  const maxLockup = deskData.maxLockupSecs || deskData.max_lockup_secs;
  const owner = deskData.owner;
  
  console.log(`   min_usd_amount_8d: ${minUsd?.toString()} ($${minUsd ? Number(minUsd.toString()) / 1e8 : 'N/A'})`);
  console.log(`   max_token_per_order: ${maxToken?.toString()}`);
  console.log(`   quote_expiry_secs: ${quoteExpiry?.toString()}`);
  console.log(`   default_unlock_delay_secs: ${unlockDelay?.toString()}`);
  console.log(`   max_lockup_secs: ${maxLockup?.toString()}`);

  // Verify we're the owner
  if (!owner.equals(ownerKeypair.publicKey)) {
    throw new Error(`Not the desk owner. Owner is ${owner.toString()}, we are ${ownerKeypair.publicKey.toString()}`);
  }

  // New limits: $0.01 minimum (1_000_000 in 8d format)
  const newMinUsd8d = new BN(1_000_000); // $0.01
  const maxTokenPerOrder = new BN(maxToken?.toString() || "1000000000000000000"); // Keep existing or 1e18
  const quoteExpirySecs = new BN(quoteExpiry?.toString() || "1800"); // Keep existing or 30 min
  const defaultUnlockDelaySecs = new BN(unlockDelay?.toString() || "0");
  const maxLockupSecs = new BN(maxLockup?.toString() || "31536000"); // 1 year

  console.log("\n⚙️  Setting new limits...");
  console.log(`   new min_usd_amount_8d: ${newMinUsd8d.toString()} ($${Number(newMinUsd8d.toString()) / 1e8})`);

  const tx = await program.methods
    .setLimits(
      newMinUsd8d,
      maxTokenPerOrder,
      quoteExpirySecs,
      defaultUnlockDelaySecs,
      maxLockupSecs,
    )
    .accounts({
      desk: deskAddress,
      owner: ownerKeypair.publicKey,
    })
    .signers([ownerKeypair])
    .rpc({ skipPreflight: false });

  console.log("✅ Limits updated. Tx:", tx);
  console.log(`   View on Solscan: https://solscan.io/tx/${tx}`);

  // Clean up temp wallet
  fs.unlinkSync(tempWalletPath);

  // Verify new limits
  console.log("\n📊 Verifying new limits...");
  // biome-ignore lint/suspicious/noExplicitAny: Anchor types are dynamic
  const newDeskData = await program.account.desk.fetch(deskAddress) as any;
  const newMinUsd = newDeskData.minUsdAmount8d || newDeskData.min_usd_amount_8d;
  console.log(`   min_usd_amount_8d: ${newMinUsd?.toString()} ($${newMinUsd ? Number(newMinUsd.toString()) / 1e8 : 'N/A'})`);
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
