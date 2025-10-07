import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { promises as fs } from "fs";
import path from "path";

const POLL_INTERVAL = 30_000; // Check every 30 seconds
const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "http://127.0.0.1:8899";
const SOLANA_DESK = process.env.NEXT_PUBLIC_SOLANA_DESK;

interface PendingClaim {
  offerAddress: string;
  beneficiary: string;
  unlockTime: number;
  tokenAmount: string;
}

class SolanaClaimWorker {
  private connection: Connection;
  private program: any;
  private deskKeypair: Keypair | null = null;
  private desk: PublicKey | null = null;
  private running = false;
  private pendingClaims = new Map<string, PendingClaim>();

  constructor() {
    this.connection = new Connection(SOLANA_RPC, "confirmed");
  }

  async initialize() {
    if (!SOLANA_DESK) {
      console.log("[SolanaClaimWorker] SOLANA_DESK not configured, skipping");
      return false;
    }

    // Load desk keypair
    const deskKeypairPath = path.join(
      process.cwd(),
      "solana/otc-program/desk-keypair.json"
    );
    const deskKeypairData = JSON.parse(
      await fs.readFile(deskKeypairPath, "utf8")
    );
    this.deskKeypair = Keypair.fromSecretKey(Uint8Array.from(deskKeypairData));
    this.desk = new PublicKey(SOLANA_DESK);

    // Load IDL and create program
    const idlPath = path.join(
      process.cwd(),
      "solana/otc-program/target/idl/otc.json"
    );
    const idl = JSON.parse(await fs.readFile(idlPath, "utf8"));

    // Create wallet for Anchor
    const wallet = {
      publicKey: this.deskKeypair.publicKey,
      signTransaction: async (tx: any) => {
        tx.partialSign(this.deskKeypair!);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach((tx) => tx.partialSign(this.deskKeypair!));
        return txs;
      },
    };

    const provider = new anchor.AnchorProvider(this.connection, wallet as any, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    this.program = new (anchor as any).Program(idl, provider);

    console.log("[SolanaClaimWorker] Initialized with desk:", SOLANA_DESK);
    return true;
  }

  async start() {
    if (this.running) return;

    const initialized = await this.initialize();
    if (!initialized) {
      console.log("[SolanaClaimWorker] Not starting - initialization failed");
      return;
    }

    this.running = true;
    console.log(
      "[SolanaClaimWorker] Started - checking for claimable offers every 30s"
    );

    this.poll();
  }

  stop() {
    this.running = false;
    console.log("[SolanaClaimWorker] Stopped");
  }

  private async poll() {
    if (!this.running) return;

    await this.processClaimableOffers();

    if (this.running) {
      setTimeout(() => this.poll(), POLL_INTERVAL);
    }
  }

  addPendingClaim(claim: PendingClaim) {
    this.pendingClaims.set(claim.offerAddress, claim);
    console.log("[SolanaClaimWorker] Added pending claim:", claim.offerAddress);
  }

  private async processClaimableOffers() {
    if (!this.program || !this.desk || !this.deskKeypair) return;

    const now = Math.floor(Date.now() / 1000);
    const toProcess = Array.from(this.pendingClaims.entries()).filter(
      ([, claim]) => now >= claim.unlockTime
    );

    if (toProcess.length === 0) {
      console.log(
        `[SolanaClaimWorker] No offers ready to claim (${this.pendingClaims.size} pending)`
      );
      return;
    }

    console.log(
      `[SolanaClaimWorker] Processing ${toProcess.length} claimable offers`
    );

    for (const [offerAddress, claim] of toProcess) {
      await this.claimOffer(offerAddress, claim);
      this.pendingClaims.delete(offerAddress);
    }
  }

  private async claimOffer(offerAddress: string, claim: PendingClaim) {
    if (!this.program || !this.desk || !this.deskKeypair) return;

    console.log(`[SolanaClaimWorker] Claiming offer ${offerAddress}`);

    const offer = new PublicKey(offerAddress);
    const beneficiary = new PublicKey(claim.beneficiary);

    // Fetch offer data
    const offerData = await this.program.account.offer.fetch(offer);

    if (offerData.fulfilled) {
      console.log(`[SolanaClaimWorker] Offer ${offerAddress} already claimed`);
      return;
    }

    if (!offerData.paid) {
      console.log(
        `[SolanaClaimWorker] Offer ${offerAddress} not paid yet, skipping`
      );
      return;
    }

    // Get desk data for token mint
    const deskData = await this.program.account.desk.fetch(this.desk);
    const tokenMint = new PublicKey(deskData.tokenMint);

    // Get associated token accounts
    const deskTokenTreasury = await getAssociatedTokenAddress(
      tokenMint,
      this.desk,
      true
    );
    const beneficiaryTokenAta = await getAssociatedTokenAddress(
      tokenMint,
      beneficiary,
      false
    );

    // Note: This will fail because claim() expects desk to be a PDA
    // For now, log the attempt - we can fix later or redesign
    const tx = await this.program.methods
      .claim(new (anchor as any).BN(offerData.id))
      .accounts({
        desk: this.desk,
        offer,
        deskTokenTreasury,
        beneficiaryTokenAta,
        beneficiary,
        tokenProgram: new PublicKey(
          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        ),
      })
      .signers([])
      .rpc();

    console.log(`[SolanaClaimWorker] ✅ Claimed ${offerAddress}, tx: ${tx}`);
  }
}

let worker: SolanaClaimWorker | null = null;

export function startSolanaClaimWorker() {
  if (worker) {
    console.log("[SolanaClaimWorker] Already running");
    return worker;
  }

  worker = new SolanaClaimWorker();
  worker.start().catch((err) => {
    console.error("[SolanaClaimWorker] Failed to start:", err);
  });

  return worker;
}

export function stopSolanaClaimWorker() {
  if (worker) {
    worker.stop();
    worker = null;
  }
}

export function addPendingClaim(claim: PendingClaim) {
  if (worker) {
    worker.addPendingClaim(claim);
  }
}
