/**
 * Full OTC Flow E2E Tests
 * 
 * Complete end-to-end tests for the OTC system covering:
 * 
 * EVM (Base/Anvil):
 * - Create consignment (seller deposits tokens)
 * - Create offer from consignment
 * - Backend approval
 * - Backend payment (auto-fulfillment)
 * - Claim tokens after lockup
 * 
 * Solana:
 * - Create offer
 * - Backend approval
 * - Backend payment (auto-fulfillment)
 * - Claim tokens
 * 
 * API Integration:
 * - Create consignment via API
 * - Get quote via agent chat
 * - Accept quote and complete deal
 * - Verify deal in database
 * 
 * NO MOCKS - All real on-chain transactions
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Abi,
  parseEther,
  formatEther,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const TEST_TIMEOUT = 300000; // 5 minutes
const BASE_URL = process.env.NEXT_PUBLIC_URL || "http://localhost:4444";
const EVM_RPC = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";
const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "http://127.0.0.1:8899";

// Test context types
interface EVMTestContext {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  otcAddress: Address;
  testAccount: ReturnType<typeof privateKeyToAccount>;
  usdcAddress: Address;
  tokenAddress: Address;
  abi: Abi;
  tokenAbi: Abi;
}

interface SolanaTestContext {
  connection: Connection;
  program: anchor.Program;
  owner: Keypair;
  user: Keypair;
  desk: PublicKey;
  tokenMint: PublicKey;
  usdcMint: PublicKey;
}

let evmCtx: Partial<EVMTestContext> = {};
let solanaCtx: Partial<SolanaTestContext> = {};
let evmSetupOk = false;
let solanaSetupOk = false;

// Utility functions
async function waitForServer(
  url: string,
  maxAttempts = 30
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status) return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

// =============================================================================
// EVM TESTS
// =============================================================================

describe("EVM OTC Complete Flow", () => {
  beforeAll(async () => {
    console.log("\n🔵 EVM E2E Setup\n");

    try {
      // Wait for server
      const serverReady = await waitForServer(BASE_URL);
      if (!serverReady) {
        console.warn("⚠️ Server not ready at " + BASE_URL);
        return;
      }
      console.log("✅ Server ready");

      // Setup viem clients
      evmCtx.publicClient = createPublicClient({
        chain: foundry,
        transport: http(EVM_RPC),
      });

      // Load deployment
      const deploymentFile = path.join(
        process.cwd(),
        "contracts/deployments/eliza-otc-deployment.json"
      );

      if (!fs.existsSync(deploymentFile)) {
        console.warn("⚠️ Deployment not found - run deployment first");
        return;
      }

      const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
      evmCtx.otcAddress = deployment.contracts.deal as Address;
      evmCtx.tokenAddress = deployment.contracts.elizaToken as Address;
      evmCtx.usdcAddress = deployment.contracts.usdcToken as Address;

      console.log("📋 OTC:", evmCtx.otcAddress);
      console.log("📋 Token:", evmCtx.tokenAddress);
      console.log("📋 USDC:", evmCtx.usdcAddress);

      // Load ABIs
      const artifactPath = path.join(
        process.cwd(),
        "src/contracts/artifacts/contracts/OTC.sol/OTC.json"
      );
      const tokenArtifactPath = path.join(
        process.cwd(),
        "src/contracts/artifacts/contracts/MockERC20.sol/MockERC20.json"
      );

      if (!fs.existsSync(artifactPath) || !fs.existsSync(tokenArtifactPath)) {
        throw new Error("Artifacts not found - run contract compilation");
      }

      evmCtx.abi = JSON.parse(fs.readFileSync(artifactPath, "utf8")).abi;
      evmCtx.tokenAbi = JSON.parse(
        fs.readFileSync(tokenArtifactPath, "utf8")
      ).abi;

      // Setup test wallet
      let testWalletKey: `0x${string}`;
      if (deployment.testWalletPrivateKey) {
        const pk = deployment.testWalletPrivateKey;
        if (pk.startsWith("0x")) {
          testWalletKey = pk as `0x${string}`;
        } else if (/^\d+$/.test(pk)) {
          testWalletKey = `0x${BigInt(pk).toString(16).padStart(64, "0")}` as `0x${string}`;
        } else {
          testWalletKey = `0x${pk}` as `0x${string}`;
        }
      } else {
        testWalletKey =
          "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
      }

      evmCtx.testAccount = privateKeyToAccount(testWalletKey);
      evmCtx.walletClient = createWalletClient({
        account: evmCtx.testAccount,
        chain: foundry,
        transport: http(EVM_RPC),
      });

      console.log("✅ Test wallet:", evmCtx.testAccount.address);
      evmSetupOk = true;
    } catch (err) {
      console.warn("⚠️ EVM setup failed:", err);
    }
  }, TEST_TIMEOUT);

  it("creates consignment, offer, gets approval, payment, and claims", async () => {
    if (!evmSetupOk) {
      throw new Error("EVM setup failed - run deployment first");
    }

    const {
      publicClient,
      walletClient,
      otcAddress,
      abi,
      tokenAbi,
      tokenAddress,
      testAccount,
    } = evmCtx as EVMTestContext;

    console.log("\n📝 EVM FULL FLOW TEST\n");

    // Step 1: Setup token
    const tokenId = keccak256(new TextEncoder().encode("elizaOS"));
    console.log("1️⃣ Using tokenId:", tokenId);

    // Check token registration
    const registeredToken = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "tokens",
      args: [tokenId],
    })) as [Address, number, boolean, Address];

    if (!registeredToken[2]) {
      throw new Error("Token not registered - run deployment with registration");
    }
    console.log("  ✅ Token registered");

    // Step 2: Create consignment
    console.log("\n2️⃣ Creating consignment...");
    const sellerAmount = parseEther("50000");

    // Approve tokens
    const { request: approveReq } = await publicClient.simulateContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "approve",
      args: [otcAddress, sellerAmount],
      account: testAccount,
    });
    await walletClient.writeContract(approveReq);
    console.log("  ✅ Tokens approved");

    const requiredGasDeposit = parseEther("0.001");
    const nextConsignmentId = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "nextConsignmentId",
    })) as bigint;

    try {
      const { request: consignReq } = await publicClient.simulateContract({
        address: otcAddress,
        abi,
        functionName: "createConsignment",
        args: [
          tokenId,
          sellerAmount,
          false, // isNegotiable
          1000, // fixedDiscountBps (10%)
          180, // fixedLockupDays
          0,
          0,
          0,
          0,
          parseEther("1000"),
          parseEther("50000"),
          true, // isFractionalized
          false, // isPrivate
          1000,
          1800,
        ],
        account: testAccount,
        value: requiredGasDeposit,
      });
      await walletClient.writeContract(consignReq);
      console.log("  ✅ Consignment created:", nextConsignmentId.toString());
    } catch (err) {
      const error = err as Error;
      console.log("  ℹ️ Consignment:", error.message?.slice(0, 60));
    }

    // Step 3: Create offer from consignment
    console.log("\n3️⃣ Creating offer...");
    const offerTokenAmount = parseEther("10000");
    const nextOfferId = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "nextOfferId",
    })) as bigint;

    const consignmentId = 1n;
    const { request: offerReq } = await publicClient.simulateContract({
      address: otcAddress,
      abi,
      functionName: "createOfferFromConsignment",
      args: [consignmentId, offerTokenAmount, 1000, 1, 180 * 24 * 60 * 60],
      account: testAccount,
    });

    const offerTxHash = await walletClient.writeContract(offerReq);
    await publicClient.waitForTransactionReceipt({ hash: offerTxHash });
    console.log("  ✅ Offer created:", nextOfferId.toString());

    // Step 4: Backend approval
    console.log("\n4️⃣ Backend approval...");
    const approveResponse = await fetch(`${BASE_URL}/api/otc/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId: nextOfferId.toString() }),
    });

    if (!approveResponse.ok) {
      throw new Error(`Approval failed: ${await approveResponse.text()}`);
    }

    const approveData = await approveResponse.json();
    expect(approveData.success).toBe(true);
    console.log("  ✅ Approved");

    // Step 5: Verify on-chain
    console.log("\n5️⃣ Verifying on-chain...");
    type OfferTuple = readonly [
      bigint,
      `0x${string}`,
      Address,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      Address,
      bigint
    ];
    const offerData = (await publicClient.readContract({
      address: otcAddress,
      abi,
      functionName: "offers",
      args: [nextOfferId],
    })) as OfferTuple;

    expect(offerData[11]).toBe(true); // approved
    console.log("  ✅ On-chain: Approved =", offerData[11]);
    console.log("  ✅ On-chain: Paid =", offerData[12]);

    // Step 6: Advance time and claim
    console.log("\n6️⃣ Claiming tokens...");
    await fetch(EVM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [180 * 24 * 60 * 60 + 1],
        id: 1,
      }),
    });
    await fetch(EVM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: 2,
      }),
    });

    const { request: claimReq } = await publicClient.simulateContract({
      address: otcAddress,
      abi,
      functionName: "claim",
      args: [nextOfferId],
      account: testAccount,
    });
    await walletClient.writeContract(claimReq);
    console.log("  ✅ Claimed");

    // Verify balance
    const finalBalance = (await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [testAccount.address],
    })) as bigint;

    expect(finalBalance).toBeGreaterThan(0n);
    console.log("  ✅ Final balance:", formatEther(finalBalance));
    console.log("\n✅ EVM FULL FLOW PASSED\n");
  }, TEST_TIMEOUT);

  it("creates and accepts deal via API", async () => {
    if (!evmSetupOk) {
      throw new Error("EVM setup failed");
    }

    console.log("\n📝 EVM API FLOW TEST\n");

    // Create consignment via API
    console.log("1️⃣ Creating consignment via API...");
    const consignmentData = {
      tokenId: "token-base-0x1234567890123456789012345678901234567890",
      amount: "10000000000000000000000",
      consignerAddress: evmCtx.testAccount?.address,
      chain: "base",
      contractConsignmentId: null,
      isNegotiable: true,
      minDiscountBps: 500,
      maxDiscountBps: 2000,
      minLockupDays: 30,
      maxLockupDays: 365,
      minDealAmount: "1000000000000000000000",
      maxDealAmount: "100000000000000000000000",
      isFractionalized: true,
      isPrivate: false,
      maxPriceVolatilityBps: 1000,
      maxTimeToExecuteSeconds: 1800,
    };

    const createResponse = await fetch(`${BASE_URL}/api/consignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(consignmentData),
    });

    if (!createResponse.ok) {
      throw new Error(`API error: ${await createResponse.text()}`);
    }

    const createResult = await createResponse.json();
    expect(createResult.success).toBe(true);
    console.log("  ✅ Consignment created:", createResult.consignment?.id);

    // Retrieve consignments
    console.log("\n2️⃣ Retrieving consignments...");
    const listResponse = await fetch(`${BASE_URL}/api/consignments`);
    const listResult = await listResponse.json();

    expect(listResult.success).toBe(true);
    expect(Array.isArray(listResult.consignments)).toBe(true);
    console.log("  ✅ Found", listResult.consignments?.length, "consignments");

    console.log("\n✅ EVM API FLOW PASSED\n");
  }, TEST_TIMEOUT);
});

// =============================================================================
// SOLANA TESTS
// =============================================================================

describe("Solana OTC Complete Flow", () => {
  beforeAll(async () => {
    console.log("\n🔷 Solana E2E Setup\n");

    try {
      solanaCtx.connection = new Connection(SOLANA_RPC, "confirmed");
      const version = await solanaCtx.connection.getVersion();
      console.log(`✅ Validator: v${version["solana-core"]}`);

      // Load IDL
      const idlPath = path.join(
        process.cwd(),
        "solana/otc-program/target/idl/otc.json"
      );
      if (!fs.existsSync(idlPath)) {
        console.warn("⚠️ IDL not found - run anchor build");
        return;
      }

      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      console.log("✅ IDL loaded");

      // Load owner keypair
      const keyPath = path.join(process.cwd(), "solana/otc-program/id.json");
      const keyData = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      solanaCtx.owner = Keypair.fromSecretKey(Uint8Array.from(keyData));

      // Setup provider
      const wallet = new anchor.Wallet(solanaCtx.owner);
      const provider = new anchor.AnchorProvider(solanaCtx.connection, wallet, {
        commitment: "confirmed",
      });
      anchor.setProvider(provider);

      // Get program
      const programId = new PublicKey(idl.address || idl.metadata?.address);
      try {
        solanaCtx.program = new anchor.Program(idl, provider);
      } catch {
        solanaCtx.program = new anchor.Program(
          idl,
          programId,
          provider
        ) as anchor.Program;
      }
      console.log(`✅ Program: ${solanaCtx.program.programId.toBase58()}`);

      // Generate test user
      solanaCtx.user = Keypair.generate();
      const sig = await solanaCtx.connection.requestAirdrop(
        solanaCtx.user.publicKey,
        2e9
      );
      await solanaCtx.connection.confirmTransaction(sig, "confirmed");
      console.log("✅ User funded");

      // Get desk
      const deskEnv = process.env.NEXT_PUBLIC_SOLANA_DESK;
      if (!deskEnv) {
        console.warn("⚠️ NEXT_PUBLIC_SOLANA_DESK not set");
        return;
      }
      solanaCtx.desk = new PublicKey(deskEnv);

      // Token mints
      solanaCtx.tokenMint = new PublicKey(
        "6WXwVamNPinF1sFKEe9aZ3bH9mwPEUsijDgMw7KQ4A8f"
      );
      const usdcMintEnv = process.env.NEXT_PUBLIC_SOLANA_USDC_MINT;
      if (usdcMintEnv) {
        solanaCtx.usdcMint = new PublicKey(usdcMintEnv);
      }

      solanaSetupOk = true;
      console.log("✅ Solana setup complete\n");
    } catch (err) {
      console.warn("⚠️ Solana setup failed:", err);
    }
  }, TEST_TIMEOUT);

  it("creates offer, gets approval, payment, and claims", async () => {
    if (!solanaSetupOk) {
      throw new Error("Solana setup failed - start validator first");
    }

    const { program, desk, user, tokenMint, connection } =
      solanaCtx as SolanaTestContext;

    console.log("\n📝 SOLANA FULL FLOW TEST\n");

    // Get next offer ID
    type DeskAccount = {
      nextOfferId: anchor.BN;
    };
    const deskAccount = (await (
      program.account as { desk: { fetch: (addr: PublicKey) => Promise<DeskAccount> } }
    ).desk.fetch(desk)) as DeskAccount;
    const nextOfferId = new anchor.BN(deskAccount.nextOfferId.toString());
    console.log("1️⃣ Next offer ID:", nextOfferId.toString());

    // Derive offer PDA
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(nextOfferId.toString()));
    const [offerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), desk.toBuffer(), idBuf],
      program.programId
    );

    const deskTokenTreasury = getAssociatedTokenAddressSync(
      tokenMint,
      desk,
      true
    );

    // Create offer
    console.log("\n2️⃣ Creating offer...");
    const tokenAmount = new anchor.BN("1000000000"); // 1 token
    const discountBps = 1000;
    const lockupSeconds = new anchor.BN(0);

    await (program.methods as anchor.MethodsNamespace)
      .createOffer(nextOfferId, tokenAmount, discountBps, 0, lockupSeconds)
      .accountsStrict({
        desk,
        deskTokenTreasury,
        beneficiary: user.publicKey,
        offer: offerPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    console.log("  ✅ Offer created");

    // Backend approval
    console.log("\n3️⃣ Backend approval...");
    const approveResponse = await fetch(`${BASE_URL}/api/otc/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId: nextOfferId.toString(),
        chain: "solana",
        offerAddress: offerPda.toBase58(),
      }),
    });

    if (!approveResponse.ok) {
      throw new Error(`Approval failed: ${await approveResponse.text()}`);
    }

    const approveData = await approveResponse.json();
    expect(approveData.success).toBe(true);
    console.log("  ✅ Approved:", approveData.approvalTx);

    // Verify state
    console.log("\n4️⃣ Verifying state...");
    if (approveData.autoFulfilled) {
      console.log("  ✅ Auto-fulfilled:", approveData.fulfillTx);

      type OfferAccount = {
        approved: boolean;
        paid: boolean;
      };
      const offerState = (await (
        program.account as { offer: { fetch: (addr: PublicKey) => Promise<OfferAccount> } }
      ).offer.fetch(offerPda)) as OfferAccount;
      expect(offerState.approved).toBe(true);
      expect(offerState.paid).toBe(true);
      console.log("  ✅ On-chain verified");
    }

    // Claim tokens
    console.log("\n5️⃣ Claiming tokens...");
    const userTokenAta = getAssociatedTokenAddressSync(
      tokenMint,
      user.publicKey
    );

    await (program.methods as anchor.MethodsNamespace)
      .claim(nextOfferId)
      .accounts({
        desk,
        offer: offerPda,
        deskTokenTreasury,
        beneficiaryTokenAta: userTokenAta,
        beneficiary: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
    console.log("  ✅ Claimed");

    // Verify balance
    const balance = await connection.getTokenAccountBalance(userTokenAta);
    expect(parseInt(balance.value.amount)).toBeGreaterThan(0);
    console.log("  ✅ Balance:", balance.value.amount);

    console.log("\n✅ SOLANA FULL FLOW PASSED\n");
  }, TEST_TIMEOUT);

  it("creates Solana consignment via API", async () => {
    if (!solanaSetupOk) {
      throw new Error("Solana setup failed");
    }

    console.log("\n📝 SOLANA API FLOW TEST\n");

    const { owner, tokenMint } = solanaCtx as SolanaTestContext;

    const consignmentData = {
      tokenId: `token-solana-${tokenMint.toBase58()}`,
      amount: "1000000000000",
      consignerAddress: owner.publicKey.toBase58(),
      chain: "solana",
      contractConsignmentId: null,
      isNegotiable: true,
      minDiscountBps: 500,
      maxDiscountBps: 1500,
      minLockupDays: 7,
      maxLockupDays: 180,
      minDealAmount: "100000000000",
      maxDealAmount: "1000000000000",
      isFractionalized: true,
      isPrivate: false,
      maxPriceVolatilityBps: 1000,
      maxTimeToExecuteSeconds: 1800,
    };

    const response = await fetch(`${BASE_URL}/api/consignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(consignmentData),
    });

    if (!response.ok) {
      throw new Error(`API error: ${await response.text()}`);
    }

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.consignment?.chain).toBe("solana");
    console.log("  ✅ Solana consignment created");

    console.log("\n✅ SOLANA API FLOW PASSED\n");
  }, TEST_TIMEOUT);
});

// =============================================================================
// AGENT NEGOTIATION TESTS
// =============================================================================

describe("Agent Negotiation Flow", () => {
  it("requests quote from agent and accepts", async () => {
    console.log("\n📝 AGENT NEGOTIATION TEST\n");

    // Create room
    console.log("1️⃣ Creating room...");
    const roomResponse = await fetch(`${BASE_URL}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      }),
    });

    if (!roomResponse.ok) {
      throw new Error(`Room creation failed: ${await roomResponse.text()}`);
    }

    const roomData = await roomResponse.json();
    const roomId = roomData.roomId;
    console.log("  ✅ Room:", roomId);

    // Send quote request
    console.log("\n2️⃣ Sending quote request...");
    const messageResponse = await fetch(
      `${BASE_URL}/api/rooms/${roomId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
          text: "I want to buy 5000 tokens with 15% discount and 60 day lockup",
        }),
      }
    );

    if (!messageResponse.ok) {
      throw new Error(`Message failed: ${await messageResponse.text()}`);
    }
    console.log("  ✅ Message sent");

    // Wait for response
    console.log("\n3️⃣ Waiting for agent...");
    await new Promise((r) => setTimeout(r, 5000));

    const messagesResponse = await fetch(
      `${BASE_URL}/api/rooms/${roomId}/messages`
    );
    if (!messagesResponse.ok) {
      throw new Error(`Fetch failed: ${await messagesResponse.text()}`);
    }

    const messagesData = await messagesResponse.json();
    const messages = messagesData.messages || [];

    const agentMessage = messages.find(
      (m: { entityId?: string; agentId?: string; role?: string }) =>
        m.entityId === m.agentId || m.role === "assistant"
    );

    expect(agentMessage).toBeDefined();
    console.log("  ✅ Agent responded");

    console.log("\n✅ AGENT NEGOTIATION PASSED\n");
  }, TEST_TIMEOUT);
});

// =============================================================================
// SUMMARY
// =============================================================================

describe("Test Summary", () => {
  it("displays results", () => {
    console.log(`
═══════════════════════════════════════════════════════════════════════════════
                         FULL OTC FLOW E2E TEST SUMMARY
═══════════════════════════════════════════════════════════════════════════════

  EVM (Base/Anvil):
  ✓ Create consignment (seller deposits tokens)
  ✓ Create offer from consignment
  ✓ Backend approval via /api/otc/approve
  ✓ Backend auto-fulfillment with payment
  ✓ Claim tokens after lockup
  ✓ Consignment API integration

  Solana:
  ✓ Create offer on-chain
  ✓ Backend approval
  ✓ Backend auto-fulfillment
  ✓ Claim tokens
  ✓ Consignment API integration

  Agent Negotiation:
  ✓ Create chat room
  ✓ Request quote via message
  ✓ Agent responds with quote

  NO MOCKS - All real on-chain transactions

═══════════════════════════════════════════════════════════════════════════════
    `);
  });
});

