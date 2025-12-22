// Emergency Refund and Critical Path Tests
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Otc } from "../target/types/otc";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

async function expectRejectedWith(promise: Promise<unknown>, expectedError: string): Promise<void> {
  try {
    await promise;
    assert.fail("Expected promise to reject but it resolved");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();
    const lowerExpected = expectedError.toLowerCase();
    // Also accept "ConstraintHasOne" for owner checks (Anchor's has_one constraint)
    const isOwnerError = lowerExpected === "owner" && lowerMessage.includes("constrainthasone");
    assert.isTrue(
      lowerMessage.includes(lowerExpected) || isOwnerError,
      `Expected error containing "${expectedError}" but got: ${errorMessage}`
    );
  }
}

describe("Emergency Refund and Critical Path Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Otc as Program<Otc>;

  const airdrop = async (pk: PublicKey, lamports: number) => {
    const sig = await provider.connection.requestAirdrop(pk, lamports);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const getTokenRegistryPda = (desk: PublicKey, tokenMint: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), desk.toBuffer(), tokenMint.toBuffer()],
      program.programId
    )[0];
  };

  let owner: Keypair;
  let agent: Keypair;
  let buyer: Keypair;
  let desk: Keypair;
  let tokenMint: PublicKey;
  let usdcMint: PublicKey;
  let tokenRegistry: PublicKey;
  let deskTokenTreasury: PublicKey;
  let deskUsdcTreasury: PublicKey;
  let ownerTokenAta: PublicKey;
  let ownerUsdcAta: PublicKey;

  beforeEach(async () => {
    owner = Keypair.generate();
    agent = Keypair.generate();
    buyer = Keypair.generate();
    desk = Keypair.generate();

    await Promise.all([
      airdrop(owner.publicKey, 10 * LAMPORTS_PER_SOL),
      airdrop(agent.publicKey, 2 * LAMPORTS_PER_SOL),
      airdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL),
    ]);
    await new Promise(r => setTimeout(r, 500));

    // Create mints
    tokenMint = await createMint(provider.connection, owner, owner.publicKey, null, 9);
    usdcMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);

    // Setup desk treasuries
    deskTokenTreasury = getAssociatedTokenAddressSync(tokenMint, desk.publicKey, true);
    deskUsdcTreasury = getAssociatedTokenAddressSync(usdcMint, desk.publicKey, true);
    tokenRegistry = getTokenRegistryPda(desk.publicKey, tokenMint);

    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, desk.publicKey, true);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, desk.publicKey, true);

    // Initialize desk
    await program.methods
      .initDesk(new anchor.BN("100000000"), new anchor.BN(60)) // $1 min, 60s expiry (minimum)
      .accounts({
        payer: owner.publicKey,
        owner: owner.publicKey,
        agent: agent.publicKey,
        usdcMint,
        desk: desk.publicKey,
      })
      .signers([owner, desk])
      .rpc();

    // Register token
    await program.methods
      .registerToken(Array(32).fill(0), PublicKey.default, 0)
      .accounts({ desk: desk.publicKey, payer: owner.publicKey, tokenMint })
      .signers([owner])
      .rpc();

    // Set prices
    await program.methods
      .setManualTokenPrice(new anchor.BN("1000000000")) // $10
      .accounts({ tokenRegistry, desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    await program.methods
      .setPrices(new anchor.BN("1000000000"), new anchor.BN("10000000000"), new anchor.BN(0), new anchor.BN(3600))
      .accounts({ desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    // Setup owner ATAs
    ownerTokenAta = getAssociatedTokenAddressSync(tokenMint, owner.publicKey);
    ownerUsdcAta = getAssociatedTokenAddressSync(usdcMint, owner.publicKey);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, owner.publicKey);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, usdcMint, owner.publicKey);
    await mintTo(provider.connection, owner, tokenMint, ownerTokenAta, owner, 1_000_000n * 10n ** 9n);
    await mintTo(provider.connection, owner, usdcMint, ownerUsdcAta, owner, 1_000_000n * 10n ** 6n);
  });

  // =====================================================
  // SET_EMERGENCY_REFUND TESTS
  // =====================================================
  describe("set_emergency_refund", () => {
    it("should enable emergency refund mode", async () => {
      await program.methods
        .setEmergencyRefund(true, new anchor.BN(7 * 86400)) // 7 days
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const deskAccount = await program.account.desk.fetch(desk.publicKey);
      assert.isTrue(deskAccount.emergencyRefundEnabled);
      assert.equal(deskAccount.emergencyRefundDeadlineSecs.toString(), (7 * 86400).toString());
    });

    it("should disable emergency refund mode", async () => {
      // First enable
      await program.methods
        .setEmergencyRefund(true, new anchor.BN(86400))
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      // Then disable
      await program.methods
        .setEmergencyRefund(false, new anchor.BN(0))
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const deskAccount = await program.account.desk.fetch(desk.publicKey);
      assert.isFalse(deskAccount.emergencyRefundEnabled);
    });

    it("should REJECT non-owner setting emergency refund", async () => {
      await expectRejectedWith(
        program.methods
          .setEmergencyRefund(true, new anchor.BN(86400))
          .accounts({ desk: desk.publicKey, owner: agent.publicKey })
          .signers([agent])
          .rpc(),
        "owner"
      );
    });
  });

  // =====================================================
  // WITHDRAW_USDC TESTS
  // =====================================================
  describe("withdraw_usdc", () => {
    beforeEach(async () => {
      // Deposit USDC to desk treasury via direct transfer
      const depositTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: desk.publicKey,
          lamports: 100000, // rent
        })
      );
      await provider.sendAndConfirm(depositTx, [owner]);

      // Deposit USDC to treasury via SPL transfer
      await mintTo(provider.connection, owner, usdcMint, deskUsdcTreasury, owner, 10_000n * 10n ** 6n);
    });

    it("should withdraw USDC from desk treasury", async () => {
      const withdrawAmount = new anchor.BN("5000000000"); // 5000 USDC
      const ownerBalanceBefore = (await getAccount(provider.connection, ownerUsdcAta)).amount;

      await program.methods
        .withdrawUsdc(withdrawAmount)
        .accounts({
          owner: owner.publicKey,
          desk: desk.publicKey,
          usdcMint,
          deskSigner: desk.publicKey,
          deskUsdcTreasury,
          toUsdcAta: ownerUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner, desk])
        .rpc();

      const ownerBalanceAfter = (await getAccount(provider.connection, ownerUsdcAta)).amount;
      assert.equal(
        (BigInt(ownerBalanceAfter) - BigInt(ownerBalanceBefore)).toString(),
        withdrawAmount.toString()
      );
    });

    it("should REJECT non-owner withdrawing USDC", async () => {
      const buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, usdcMint, buyer.publicKey
      )).address;

      await expectRejectedWith(
        program.methods
          .withdrawUsdc(new anchor.BN("1000000"))
          .accounts({
            owner: buyer.publicKey,
            desk: desk.publicKey,
            usdcMint,
            deskSigner: desk.publicKey,
            deskUsdcTreasury,
            toUsdcAta: buyerUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer, desk])
          .rpc(),
        "owner"
      );
    });
  });

  // =====================================================
  // EMERGENCY_REFUND_USDC TESTS
  // =====================================================
  describe("emergency_refund_usdc", () => {
    let consignment: Keypair;
    let offer: Keypair;
    let buyerUsdcAta: PublicKey;

    beforeEach(async () => {
      // Enable emergency refund with 1-second deadline for testing
      await program.methods
        .setEmergencyRefund(true, new anchor.BN(1))
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      // Create consignment
      consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("100000000000000"), // 100k tokens
          false, 500, 0, 0, 0, 0, 0,
          new anchor.BN("10000000000"),
          new anchor.BN("50000000000000"),
          true, false, 0, new anchor.BN(3600)
        )
        .accounts({
          desk: desk.publicKey,
          consigner: owner.publicKey,
          tokenMint,
          consignerTokenAta: ownerTokenAta,
          deskTokenTreasury,
          consignment: consignment.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner, consignment])
        .rpc();

      // Create offer
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      offer = Keypair.generate();
      buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, usdcMint, buyer.publicKey
      )).address;
      await mintTo(provider.connection, owner, usdcMint, buyerUsdcAta, owner, 1_000_000n * 10n ** 6n);

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN("10000000000"), // 10 tokens
          500, 1, new anchor.BN(0), 0
        )
        .accounts({
          desk: desk.publicKey,
          consignment: consignment.publicKey,
          tokenRegistry,
          beneficiary: buyer.publicKey,
          offer: offer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, offer])
        .rpc();

      // Fulfill offer
      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      await program.methods
        .fulfillOfferUsdc(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          usdcMint,
          deskTokenTreasury,
          deskUsdcTreasury,
          payerUsdcAta: buyerUsdcAta,
          agentUsdcAta: null,
          deskSigner: desk.publicKey,
          payer: buyer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, desk])
        .rpc();
    });

    it("should REJECT emergency refund when not enabled", async () => {
      // Disable emergency refund
      await program.methods
        .setEmergencyRefund(false, new anchor.BN(0))
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const offerAccount = await program.account.offer.fetch(offer.publicKey);

      await expectRejectedWith(
        program.methods
          .emergencyRefundUsdc(new anchor.BN(offerAccount.id.toString()))
          .accounts({
            desk: desk.publicKey,
            deskSigner: desk.publicKey,
            offer: offer.publicKey,
            usdcMint,
            caller: buyer.publicKey,
            deskUsdcTreasury,
            payerUsdcRefund: buyerUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer, desk])
          .rpc(),
        "BadState"
      );
    });

    it("should REJECT emergency refund before deadline", async () => {
      // Re-enable with long deadline
      await program.methods
        .setEmergencyRefund(true, new anchor.BN(86400 * 365)) // 1 year
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const offerAccount = await program.account.offer.fetch(offer.publicKey);

      await expectRejectedWith(
        program.methods
          .emergencyRefundUsdc(new anchor.BN(offerAccount.id.toString()))
          .accounts({
            desk: desk.publicKey,
            deskSigner: desk.publicKey,
            offer: offer.publicKey,
            usdcMint,
            caller: buyer.publicKey,
            deskUsdcTreasury,
            payerUsdcRefund: buyerUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer, desk])
          .rpc(),
        "TooEarlyForRefund"
      );
    });

    it("should execute emergency refund after deadline", async () => {
      // Wait for deadline (1 second)
      await new Promise(r => setTimeout(r, 2000));

      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      const buyerUsdcBefore = (await getAccount(provider.connection, buyerUsdcAta)).amount;

      await program.methods
        .emergencyRefundUsdc(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          deskSigner: desk.publicKey,
          offer: offer.publicKey,
          usdcMint,
          caller: buyer.publicKey,
          deskUsdcTreasury,
          payerUsdcRefund: buyerUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer, desk])
        .rpc();

      // Verify refund
      const buyerUsdcAfter = (await getAccount(provider.connection, buyerUsdcAta)).amount;
      assert.isTrue(BigInt(buyerUsdcAfter) > BigInt(buyerUsdcBefore));

      // Verify offer is cancelled
      const offerAfter = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAfter.cancelled);
    });
  });

  // =====================================================
  // EMERGENCY_REFUND_SOL TESTS
  // =====================================================
  describe("emergency_refund_sol", () => {
    let consignment: Keypair;
    let offer: Keypair;

    beforeEach(async () => {
      // Enable emergency refund
      await program.methods
        .setEmergencyRefund(true, new anchor.BN(1))
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      // Create consignment
      consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("100000000000000"),
          false, 500, 0, 0, 0, 0, 0,
          new anchor.BN("1000000000"), // 1 token min (small amount)
          new anchor.BN("50000000000000"),
          true, false, 0, new anchor.BN(3600)
        )
        .accounts({
          desk: desk.publicKey,
          consigner: owner.publicKey,
          tokenMint,
          consignerTokenAta: ownerTokenAta,
          deskTokenTreasury,
          consignment: consignment.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner, consignment])
        .rpc();

      // Create SOL offer
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN("1000000000"), // 1 token = $10 -> 0.1 SOL
          500, 0, // SOL payment
          new anchor.BN(0), 0
        )
        .accounts({
          desk: desk.publicKey,
          consignment: consignment.publicKey,
          tokenRegistry,
          beneficiary: buyer.publicKey,
          offer: offer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, offer])
        .rpc();

      // Fulfill with SOL
      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      await program.methods
        .fulfillOfferSol(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          deskTokenTreasury,
          agent: null,
          deskSigner: desk.publicKey,
          payer: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, desk])
        .rpc();
    });

    it("should execute SOL emergency refund after deadline", async () => {
      await new Promise(r => setTimeout(r, 2000));

      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      const buyerSolBefore = await provider.connection.getBalance(buyer.publicKey);

      await program.methods
        .emergencyRefundSol(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          deskSigner: desk.publicKey,
          offer: offer.publicKey,
          caller: buyer.publicKey,
          payerRefund: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, desk])
        .rpc();

      const buyerSolAfter = await provider.connection.getBalance(buyer.publicKey);
      // Balance should increase (minus tx fee)
      assert.isTrue(buyerSolAfter > buyerSolBefore - 10000);

      const offerAfter = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAfter.cancelled);
    });
  });
});
