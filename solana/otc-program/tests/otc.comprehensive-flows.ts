// OTC Comprehensive Flow Tests - E2E flows, edge cases, error handling
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

// Helper to assert promise rejects with specific error message
async function expectRejectedWith(promise: Promise<unknown>, expectedError: string): Promise<void> {
  try {
    await promise;
    assert.fail("Expected promise to reject but it resolved");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    assert.include(errorMessage, expectedError, `Expected error containing "${expectedError}" but got: ${errorMessage}`);
  }
}

describe("OTC Comprehensive Flow Tests", () => {
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

  // Shared test accounts
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

  beforeEach(async () => {
    owner = Keypair.generate();
    agent = Keypair.generate();
    buyer = Keypair.generate();
    desk = Keypair.generate();

    await Promise.all([
      airdrop(owner.publicKey, 5 * LAMPORTS_PER_SOL),
      airdrop(agent.publicKey, 2 * LAMPORTS_PER_SOL),
      airdrop(buyer.publicKey, 5 * LAMPORTS_PER_SOL),
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

    // Initialize desk with agent
    await program.methods
      .initDesk(new anchor.BN(1 * 1e8), new anchor.BN(1800)) // $1 min, 30 min expiry
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

    // Set token price: $10 per token
    await program.methods
      .setManualTokenPrice(new anchor.BN(10 * 1e8))
      .accounts({ tokenRegistry, desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    // Set SOL price: $100
    await program.methods
      .setPrices(new anchor.BN(10 * 1e8), new anchor.BN(100 * 1e8), new anchor.BN(0), new anchor.BN(3600))
      .accounts({ desk: desk.publicKey, owner: owner.publicKey })
      .signers([owner])
      .rpc();

    // Mint tokens to owner
    ownerTokenAta = getAssociatedTokenAddressSync(tokenMint, owner.publicKey);
    await getOrCreateAssociatedTokenAccount(provider.connection, owner, tokenMint, owner.publicKey);
    await mintTo(provider.connection, owner, tokenMint, ownerTokenAta, owner, 1_000_000n * 10n ** 9n); // 1M tokens
  });

  // =====================================================
  // CONSIGNMENT TESTS
  // =====================================================
  describe("Consignment Creation", () => {
    it("should create a negotiable consignment with correct parameters", async () => {
      const consignment = Keypair.generate();
      const amount = new anchor.BN(100_000n * 10n ** 9n); // 100k tokens

      await program.methods
        .createConsignment(
          amount,
          true, // is_negotiable
          500, // fixed_discount_bps (5%)
          30, // fixed_lockup_days
          100, // min_discount_bps (1%)
          1000, // max_discount_bps (10%)
          7, // min_lockup_days
          365, // max_lockup_days
          new anchor.BN(1000 * 1e9), // min_deal_amount (1000 tokens)
          new anchor.BN(50000 * 1e9), // max_deal_amount (50k tokens)
          true, // is_fractionalized
          false, // is_private
          500, // max_price_volatility_bps
          new anchor.BN(3600) // max_time_to_execute_secs
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

      // Verify consignment state
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      assert.equal(consignmentAccount.desk.toBase58(), desk.publicKey.toBase58());
      assert.equal(consignmentAccount.totalAmount.toString(), amount.toString());
      assert.equal(consignmentAccount.remainingAmount.toString(), amount.toString());
      assert.isTrue(consignmentAccount.isNegotiable);
      assert.isTrue(consignmentAccount.isActive);
      assert.equal(consignmentAccount.fixedDiscountBps, 500);
      assert.equal(consignmentAccount.minDiscountBps, 100);
      assert.equal(consignmentAccount.maxDiscountBps, 1000);

      // Verify tokens were transferred to treasury
      const treasuryBalance = await getAccount(provider.connection, deskTokenTreasury);
      assert.equal(treasuryBalance.amount.toString(), amount.toString());
    });

    it("should create a fixed-price (P2P) consignment", async () => {
      const consignment = Keypair.generate();
      const amount = new anchor.BN(50_000n * 10n ** 9n);

      await program.methods
        .createConsignment(
          amount,
          false, // NOT negotiable (P2P)
          300, // fixed_discount_bps (3%)
          14, // fixed_lockup_days
          0, 0, 0, 0, // min/max ignored for P2P
          new anchor.BN(1000 * 1e9),
          amount, // max = total for non-fractionalized
          false, // NOT fractionalized
          false,
          0,
          new anchor.BN(3600)
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      assert.isFalse(consignmentAccount.isNegotiable);
      assert.isFalse(consignmentAccount.isFractionalized);
    });

    it("should REJECT consignment with zero amount", async () => {
      const consignment = Keypair.generate();

      await expectRejectedWith(
        program.methods
          .createConsignment(
            new anchor.BN(0), // ZERO amount
            true, 500, 30, 100, 1000, 7, 365,
            new anchor.BN("1000000000"), new anchor.BN("1000000000000000000"),
            true, false, 500, new anchor.BN(3600)
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
          .rpc(),
        "AmountRange"
      );
    });

    it("should REJECT consignment with min > max deal amount", async () => {
      const consignment = Keypair.generate();

      await expectRejectedWith(
        program.methods
          .createConsignment(
            new anchor.BN(100_000n * 10n ** 9n),
            true, 500, 30, 100, 1000, 7, 365,
            new anchor.BN(50000 * 1e9), // min > max
            new anchor.BN(10000 * 1e9),
            true, false, 500, new anchor.BN(3600)
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
          .rpc(),
        "AmountRange"
      );
    });

    it("should REJECT consignment with discount > 100%", async () => {
      const consignment = Keypair.generate();

      await expectRejectedWith(
        program.methods
          .createConsignment(
            new anchor.BN("100000000000000"), // 100k tokens
            true, 500, 30, 100, 
            10001, // > 100%
            7, 365,
            new anchor.BN("1000000000"), new anchor.BN("1000000000000000000"),
            true, false, 500, new anchor.BN(3600)
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
          .rpc(),
        "Discount"
      );
    });

    it("should REJECT consignment when desk is paused", async () => {
      // Pause desk
      await program.methods.pause()
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const consignment = Keypair.generate();

      await expectRejectedWith(
        program.methods
          .createConsignment(
            new anchor.BN("100000000000000"), // 100k tokens
            true, 500, 30, 100, 1000, 7, 365,
            new anchor.BN("1000000000"), new anchor.BN("1000000000000000000"),
            true, false, 500, new anchor.BN(3600)
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
          .rpc(),
        "Paused"
      );

      // Unpause for other tests
      await program.methods.unpause()
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();
    });
  });

  // =====================================================
  // COMPLETE OTC FLOW TESTS
  // =====================================================
  describe("Complete OTC Flow - USDC Payment", () => {
    let consignment: Keypair;
    let offer: Keypair;
    let buyerUsdcAta: PublicKey;
    let buyerTokenAta: PublicKey;

    beforeEach(async () => {
      // Create consignment
      consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
          true, false, 500, new anchor.BN(3600)
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

      // Add agent as approver
      await program.methods.setApprover(agent.publicKey, true)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      // Setup buyer accounts
      buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, usdcMint, buyer.publicKey
      )).address;
      await mintTo(provider.connection, owner, usdcMint, buyerUsdcAta, owner, 1_000_000n * 10n ** 6n);

      buyerTokenAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, tokenMint, buyer.publicKey
      )).address;
    });

    it("should complete full negotiable flow: create offer → approve → fulfill → claim", async () => {
      offer = Keypair.generate();
      const tokenAmount = new anchor.BN(10_000n * 10n ** 9n); // 10k tokens
      const discountBps = 500; // 5%
      const agentCommissionBps = 50; // 0.5%

      // Get consignment ID
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);

      // 1. Create offer from consignment
      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          tokenAmount,
          discountBps,
          1, // USDC
          new anchor.BN(0), // no lockup
          agentCommissionBps
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

      // Verify offer created but not approved (negotiable)
      let offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isFalse(offerAccount.approved);
      assert.equal(offerAccount.tokenAmount.toString(), tokenAmount.toString());
      assert.equal(offerAccount.discountBps, discountBps);
      assert.equal(offerAccount.agentCommissionBps, agentCommissionBps);

      // 2. Approve offer (by agent)
      await program.methods
        .approveOffer(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          consignment: consignment.publicKey,
          approver: agent.publicKey,
        })
        .signers([agent])
        .rpc();

      offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.approved);

      // 3. Fulfill offer with USDC
      // Calculate expected payment: 10k tokens * $10 * (1 - 5%) = $95,000
      const agentUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, agent, usdcMint, agent.publicKey
      )).address;

      const buyerUsdcBefore = (await getAccount(provider.connection, buyerUsdcAta)).amount;
      const treasuryUsdcBefore = (await getAccount(provider.connection, deskUsdcTreasury)).amount;

      await program.methods
        .fulfillOfferUsdc(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          usdcMint,
          deskTokenTreasury,
          deskUsdcTreasury,
          payerUsdcAta: buyerUsdcAta,
          agentUsdcAta,
          deskSigner: desk.publicKey,
          payer: buyer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, desk])
        .rpc();

      offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.paid);
      assert.isTrue(offerAccount.amountPaid.toNumber() > 0);

      // Verify USDC transferred
      const buyerUsdcAfter = (await getAccount(provider.connection, buyerUsdcAta)).amount;
      assert.isTrue(buyerUsdcAfter < buyerUsdcBefore);

      // Verify commission paid to agent
      const agentUsdcBalance = (await getAccount(provider.connection, agentUsdcAta)).amount;
      assert.isTrue(Number(agentUsdcBalance) > 0);

      // 4. Claim tokens
      await program.methods
        .claim(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          deskSigner: desk.publicKey,
          offer: offer.publicKey,
          tokenMint,
          deskTokenTreasury,
          beneficiaryTokenAta: buyerTokenAta,
          beneficiary: buyer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([desk])
        .rpc();

      offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.fulfilled);

      // Verify tokens received
      const buyerTokenBalance = (await getAccount(provider.connection, buyerTokenAta)).amount;
      assert.equal(buyerTokenBalance.toString(), tokenAmount.toString());
    });

    it("should auto-approve P2P (non-negotiable) offers", async () => {
      // Create P2P consignment
      const p2pConsignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(50_000n * 10n ** 9n),
          false, // P2P
          300, // fixed 3% discount
          0, 0, 0, 0, 0,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
          true, false, 0, new anchor.BN(3600)
        )
        .accounts({
          desk: desk.publicKey,
          consigner: owner.publicKey,
          tokenMint,
          consignerTokenAta: ownerTokenAta,
          deskTokenTreasury,
          consignment: p2pConsignment.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner, p2pConsignment])
        .rpc();

      const p2pConsignmentAccount = await program.account.consignment.fetch(p2pConsignment.publicKey);

      // Create offer - should be auto-approved
      offer = Keypair.generate();
      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(p2pConsignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
          300, // must match fixed discount
          1, 
          new anchor.BN(0), // must match fixed lockup (0)
          0 // ignored for P2P
        )
        .accounts({
          desk: desk.publicKey,
          consignment: p2pConsignment.publicKey,
          tokenRegistry,
          beneficiary: buyer.publicKey,
          offer: offer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, offer])
        .rpc();

      // P2P offers are auto-approved
      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.approved);
    });
  });

  // =====================================================
  // SOL PAYMENT FLOW
  // =====================================================
  describe("Complete OTC Flow - SOL Payment", () => {
    let consignment: Keypair;

    beforeEach(async () => {
      consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("100000000000000"), // 100k tokens
          false, // P2P for simplicity
          500, 0, 0, 0, 0, 0,
          new anchor.BN("10000000000"), // 10 tokens min
          new anchor.BN("50000000000000"), // 50k tokens max
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
    });

    it("should complete SOL payment flow with balance verification", async () => {
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();
      // Use smaller amount: 40 tokens * $10 * 5% discount = $380 worth
      // At $100/SOL = 3.8 SOL (affordable with 5 SOL airdrop)
      const tokenAmount = new anchor.BN("40000000000"); // 40 tokens

      // Create offer with SOL payment (currency = 0)
      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          tokenAmount,
          500, 0, // currency = SOL
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

      let offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.equal(offerAccount.currency, 0); // SOL

      // Record balances before
      const buyerSolBefore = await provider.connection.getBalance(buyer.publicKey);
      const deskSolBefore = await provider.connection.getBalance(desk.publicKey);

      // Fulfill with SOL
      await program.methods
        .fulfillOfferSol(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          deskTokenTreasury,
          agent: null, // no commission for P2P in this test
          deskSigner: desk.publicKey,
          payer: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, desk])
        .rpc();

      offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.paid);

      // Verify SOL transferred
      const buyerSolAfter = await provider.connection.getBalance(buyer.publicKey);
      const deskSolAfter = await provider.connection.getBalance(desk.publicKey);
      assert.isTrue(buyerSolAfter < buyerSolBefore);
      assert.isTrue(deskSolAfter > deskSolBefore);

      // Claim tokens
      const buyerTokenAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, tokenMint, buyer.publicKey
      )).address;

      await program.methods
        .claim(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          deskSigner: desk.publicKey,
          offer: offer.publicKey,
          tokenMint,
          deskTokenTreasury,
          beneficiaryTokenAta: buyerTokenAta,
          beneficiary: buyer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([desk])
        .rpc();

      const buyerTokenBalance = (await getAccount(provider.connection, buyerTokenAta)).amount;
      assert.equal(buyerTokenBalance.toString(), tokenAmount.toString());
    });
  });

  // =====================================================
  // CANCEL FLOW TESTS
  // =====================================================
  describe("Cancel Offer Flows", () => {
    let consignment: Keypair;
    let offer: Keypair;

    beforeEach(async () => {
      consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
          true, false, 500, new anchor.BN(3600)
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

      // Add agent as approver
      await program.methods.setApprover(agent.publicKey, true)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();
    });

    it("should allow owner to cancel unapproved offer", async () => {
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
          500, 1, new anchor.BN(0), 50
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

      // Owner cancels
      await program.methods
        .cancelOfferWithConsignment()
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          consignment: consignment.publicKey,
          caller: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.cancelled);

      // Verify tokens restored to consignment
      const consignmentAfter = await program.account.consignment.fetch(consignment.publicKey);
      assert.equal(
        consignmentAfter.remainingAmount.toString(),
        consignmentAccount.remainingAmount.toString()
      );
    });

    it("should allow agent to cancel offer", async () => {
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
          500, 1, new anchor.BN(0), 50
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

      // Agent cancels
      await program.methods
        .cancelOfferWithConsignment()
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          consignment: consignment.publicKey,
          caller: agent.publicKey,
        })
        .signers([agent])
        .rpc();

      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAccount.cancelled);
    });

    it("should REJECT buyer cancel before expiry", async () => {
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
          500, 1, new anchor.BN(0), 50
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

      // Buyer tries to cancel before expiry
      await expectRejectedWith(
        program.methods
          .cancelOfferWithConsignment()
          .accounts({
            desk: desk.publicKey,
            offer: offer.publicKey,
            consignment: consignment.publicKey,
            caller: buyer.publicKey,
          })
          .signers([buyer])
          .rpc(),
        "NotExpired"
      );
    });
  });

  // =====================================================
  // WITHDRAW TESTS
  // =====================================================
  describe("Withdrawal Operations", () => {
    beforeEach(async () => {
      // Deposit some tokens
      await program.methods
        .depositTokens(new anchor.BN(50_000n * 10n ** 9n))
        .accounts({
          desk: desk.publicKey,
          tokenRegistry,
          tokenMint,
          owner: owner.publicKey,
          ownerTokenAta,
          deskTokenTreasury,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
    });

    it("should withdraw tokens with balance verification", async () => {
      const ownerBalanceBefore = (await getAccount(provider.connection, ownerTokenAta)).amount;
      const withdrawAmount = new anchor.BN(10_000n * 10n ** 9n);

      await program.methods
        .withdrawTokens(withdrawAmount)
        .accounts({
          owner: owner.publicKey,
          desk: desk.publicKey,
          tokenRegistry,
          tokenMint,
          deskSigner: desk.publicKey,
          deskTokenTreasury,
          ownerTokenAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner, desk])
        .rpc();

      const ownerBalanceAfter = (await getAccount(provider.connection, ownerTokenAta)).amount;
      assert.equal(
        (BigInt(ownerBalanceAfter) - BigInt(ownerBalanceBefore)).toString(),
        withdrawAmount.toString()
      );
    });

    it("should withdraw SOL maintaining rent exemption", async () => {
      // First fund the desk with some SOL
      const deskBalanceBefore = await provider.connection.getBalance(desk.publicKey);

      // Try to withdraw leaving rent
      const rentExempt = await provider.connection.getMinimumBalanceForRentExemption(
        8 + 32+32+32+1+8+8+8+1+4+(32*32)+8+8+1+32+8+8+32+1+8+8+32+8+8+8+8+1+8+2 // Desk::SIZE
      );

      const withdrawable = deskBalanceBefore - rentExempt;
      if (withdrawable > 0) {
        await program.methods
          .withdrawSol(new anchor.BN(withdrawable))
          .accounts({
            desk: desk.publicKey,
            deskSigner: desk.publicKey,
            owner: owner.publicKey,
            to: owner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner, desk])
          .rpc();

        const deskBalanceAfter = await provider.connection.getBalance(desk.publicKey);
        assert.isTrue(deskBalanceAfter >= rentExempt);
      }
    });

    it("should REJECT withdraw that would leave below rent", async () => {
      const deskBalance = await provider.connection.getBalance(desk.publicKey);

      await expectRejectedWith(
        program.methods
          .withdrawSol(new anchor.BN(deskBalance)) // Try to withdraw all
          .accounts({
            desk: desk.publicKey,
            deskSigner: desk.publicKey,
            owner: owner.publicKey,
            to: owner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner, desk])
          .rpc(),
        "BadState"
      );
    });
  });

  // =====================================================
  // CONSIGNMENT WITHDRAWAL
  // =====================================================
  describe("Consignment Withdrawal", () => {
    it("should allow consigner to withdraw remaining tokens", async () => {
      const consignment = Keypair.generate();
      const consignAmount = new anchor.BN(100_000n * 10n ** 9n);

      await program.methods
        .createConsignment(
          consignAmount,
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
          true, false, 500, new anchor.BN(3600)
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

      const ownerBalanceBefore = (await getAccount(provider.connection, ownerTokenAta)).amount;
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);

      await program.methods
        .withdrawConsignment(new anchor.BN(consignmentAccount.id.toString()))
        .accounts({
          consignment: consignment.publicKey,
          desk: desk.publicKey,
          tokenMint,
          deskSigner: desk.publicKey,
          consigner: owner.publicKey,
          deskTokenTreasury,
          consignerTokenAta: ownerTokenAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner, desk])
        .rpc();

      // Verify consignment deactivated
      const consignmentAfter = await program.account.consignment.fetch(consignment.publicKey);
      assert.isFalse(consignmentAfter.isActive);
      assert.equal(consignmentAfter.remainingAmount.toString(), "0");

      // Verify tokens returned
      const ownerBalanceAfter = (await getAccount(provider.connection, ownerTokenAta)).amount;
      assert.equal(
        (BigInt(ownerBalanceAfter) - BigInt(ownerBalanceBefore)).toString(),
        consignAmount.toString()
      );
    });

    it("should REJECT withdrawal by non-consigner", async () => {
      const consignment = Keypair.generate();

      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
          true, false, 500, new anchor.BN(3600)
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const buyerTokenAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, tokenMint, buyer.publicKey
      )).address;

      await expectRejectedWith(
        program.methods
          .withdrawConsignment(new anchor.BN(consignmentAccount.id.toString()))
          .accounts({
            consignment: consignment.publicKey,
            desk: desk.publicKey,
            tokenMint,
            deskSigner: desk.publicKey,
            consigner: buyer.publicKey, // Wrong consigner
            deskTokenTreasury,
            consignerTokenAta: buyerTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer, desk])
          .rpc(),
        "NotOwner"
      );
    });
  });

  // =====================================================
  // COMMISSION TESTS
  // =====================================================
  describe("P2P Commission", () => {
    it("should verify commission range validation in offers", async () => {
      // Create negotiable consignment
      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("100000000000000"),
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN("1000000000000"),
          new anchor.BN("50000000000000"),
          true, false, 500, new anchor.BN(3600)
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      // Should REJECT commission below 25 bps for negotiable offers
      await expectRejectedWith(
        program.methods
          .createOfferFromConsignment(
            new anchor.BN(consignmentAccount.id.toString()),
            new anchor.BN("10000000000000"),
            500, 1, new anchor.BN(0),
            10 // Too low - min is 25 bps
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
          .rpc(),
        "CommissionRange"
      );
    });

    it("should REJECT commission above 150 bps for negotiable offers", async () => {
      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("100000000000000"),
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN("1000000000000"),
          new anchor.BN("50000000000000"),
          true, false, 500, new anchor.BN(3600)
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      // Should REJECT commission above 150 bps
      await expectRejectedWith(
        program.methods
          .createOfferFromConsignment(
            new anchor.BN(consignmentAccount.id.toString()),
            new anchor.BN("10000000000000"),
            500, 1, new anchor.BN(0),
            200 // Too high - max is 150 bps
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
          .rpc(),
        "CommissionRange"
      );
    });
  });

  // =====================================================
  // LOCKUP TESTS  
  // =====================================================
  describe("Lockup Period Enforcement", () => {
    it("should REJECT claim before unlock time", async () => {
      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          false, 500, 
          1, // 1 day lockup
          0, 0, 0, 0,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      // Create and fulfill offer
      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
          500, 1, 
          new anchor.BN(86400), // 1 day lockup
          0
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

      // Setup and pay
      const buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, usdcMint, buyer.publicKey
      )).address;
      await mintTo(provider.connection, owner, usdcMint, buyerUsdcAta, owner, 1_000_000n * 10n ** 6n);

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

      // Try to claim immediately (should fail due to lockup)
      const buyerTokenAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, tokenMint, buyer.publicKey
      )).address;

      await expectRejectedWith(
        program.methods
          .claim(new anchor.BN(offerAccount.id.toString()))
          .accounts({
            desk: desk.publicKey,
            deskSigner: desk.publicKey,
            offer: offer.publicKey,
            tokenMint,
            deskTokenTreasury,
            beneficiaryTokenAta: buyerTokenAta,
            beneficiary: buyer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([desk])
          .rpc(),
        "Locked"
      );
    });
  });

  // =====================================================
  // BOUNDARY CONDITIONS
  // =====================================================
  describe("Boundary Conditions", () => {
    it("should handle minimum USD amount boundary", async () => {
      // Set very low min USD ($0.01)
      await program.methods
        .setLimits(
          new anchor.BN("1000000"), // $0.01 with 8 decimals
          new anchor.BN("1000000000000000000"),
          new anchor.BN(60),
          new anchor.BN(0),
          new anchor.BN(365 * 86400)
        )
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("1000000000"), // 1 token
          false, 0, 0, 0, 0, 0, 0,
          new anchor.BN(1), // min 1 unit
          new anchor.BN("1000000000"),
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

      // Should succeed with small amount
      const offer = Keypair.generate();
      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN("1000000000"),
          0, 1, new anchor.BN(0), 0
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

      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      assert.exists(offerAccount);
    });

    it("should REJECT offer below minimum USD", async () => {
      // Reset to higher minimum
      await program.methods
        .setLimits(
          new anchor.BN("10000000000"), // $100 minimum (8 decimals)
          new anchor.BN("1000000000000000000"),
          new anchor.BN(60),
          new anchor.BN(0),
          new anchor.BN(365 * 86400)
        )
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN("100000000000000"), // 100k tokens
          false, 0, 0, 0, 0, 0, 0,
          new anchor.BN("1000000000"),
          new anchor.BN("100000000000000"),
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      // Try to create offer worth only $10 (price is $10/token, 1 token = $10)
      await expectRejectedWith(
        program.methods
          .createOfferFromConsignment(
            new anchor.BN(consignmentAccount.id.toString()),
            new anchor.BN("1000000000"), // 1 token = $10 < $100 min
            0, 1, new anchor.BN(0), 0
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
          .rpc(),
        "MinUsd"
      );
    });
  });

  // =====================================================
  // RESTRICT FULFILL MODE
  // =====================================================
  describe("Restrict Fulfill Mode", () => {
    it("should enforce restrict fulfill when enabled", async () => {
      // Enable restrict fulfill
      await program.methods.setRestrictFulfill(true)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          false, 500, 0, 0, 0, 0, 0,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
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

      const offerAccount = await program.account.offer.fetch(offer.publicKey);
      const buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, usdcMint, buyer.publicKey
      )).address;
      await mintTo(provider.connection, owner, usdcMint, buyerUsdcAta, owner, 1_000_000n * 10n ** 6n);

      // Random third party tries to fulfill
      const thirdParty = Keypair.generate();
      await airdrop(thirdParty.publicKey, 2 * LAMPORTS_PER_SOL);
      const thirdPartyUsdc = (await getOrCreateAssociatedTokenAccount(
        provider.connection, thirdParty, usdcMint, thirdParty.publicKey
      )).address;
      await mintTo(provider.connection, owner, usdcMint, thirdPartyUsdc, owner, 1_000_000n * 10n ** 6n);

      await expectRejectedWith(
        program.methods
          .fulfillOfferUsdc(new anchor.BN(offerAccount.id.toString()))
          .accounts({
            desk: desk.publicKey,
            offer: offer.publicKey,
            usdcMint,
            deskTokenTreasury,
            deskUsdcTreasury,
            payerUsdcAta: thirdPartyUsdc,
            agentUsdcAta: null,
            deskSigner: desk.publicKey,
            payer: thirdParty.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([thirdParty, desk])
          .rpc(),
        "FulfillRestricted"
      );

      // But beneficiary should still be able to fulfill
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

      const offerAfter = await program.account.offer.fetch(offer.publicKey);
      assert.isTrue(offerAfter.paid);

      // Disable for other tests
      await program.methods.setRestrictFulfill(false)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();
    });
  });

  // =====================================================
  // AGENT MANAGEMENT
  // =====================================================
  describe("Agent Management", () => {
    it("should allow owner to change agent", async () => {
      const newAgent = Keypair.generate();

      await program.methods
        .setAgent(newAgent.publicKey)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const deskAccount = await program.account.desk.fetch(desk.publicKey);
      assert.equal(deskAccount.agent.toBase58(), newAgent.publicKey.toBase58());
    });

    it("should REJECT setting agent to default pubkey", async () => {
      await expectRejectedWith(
        program.methods
          .setAgent(PublicKey.default)
          .accounts({ desk: desk.publicKey, owner: owner.publicKey })
          .signers([owner])
          .rpc(),
        "BadState"
      );
    });
  });

  // =====================================================
  // DOUBLE-ACTION PREVENTION
  // =====================================================
  describe("Double-Action Prevention", () => {
    it("should REJECT double approval", async () => {
      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          true, 500, 0, 100, 1000, 0, 365,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
          true, false, 500, new anchor.BN(3600)
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

      await program.methods.setApprover(agent.publicKey, true)
        .accounts({ desk: desk.publicKey, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
          500, 1, new anchor.BN(0), 50
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

      const offerAccount = await program.account.offer.fetch(offer.publicKey);

      // First approval
      await program.methods
        .approveOffer(new anchor.BN(offerAccount.id.toString()))
        .accounts({
          desk: desk.publicKey,
          offer: offer.publicKey,
          consignment: consignment.publicKey,
          approver: agent.publicKey,
        })
        .signers([agent])
        .rpc();

      // Second approval should fail
      await expectRejectedWith(
        program.methods
          .approveOffer(new anchor.BN(offerAccount.id.toString()))
          .accounts({
            desk: desk.publicKey,
            offer: offer.publicKey,
            consignment: consignment.publicKey,
            approver: agent.publicKey,
          })
          .signers([agent])
          .rpc(),
        "AlreadyApproved"
      );
    });

    it("should REJECT double fulfillment", async () => {
      const consignment = Keypair.generate();
      await program.methods
        .createConsignment(
          new anchor.BN(100_000n * 10n ** 9n),
          false, 500, 0, 0, 0, 0, 0,
          new anchor.BN(1000 * 1e9),
          new anchor.BN(50000 * 1e9),
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

      const consignmentAccount = await program.account.consignment.fetch(consignment.publicKey);
      const offer = Keypair.generate();

      await program.methods
        .createOfferFromConsignment(
          new anchor.BN(consignmentAccount.id.toString()),
          new anchor.BN(10_000n * 10n ** 9n),
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

      const buyerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, buyer, usdcMint, buyer.publicKey
      )).address;
      await mintTo(provider.connection, owner, usdcMint, buyerUsdcAta, owner, 1_000_000n * 10n ** 6n);

      const offerAccount = await program.account.offer.fetch(offer.publicKey);

      // First fulfillment
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

      // Second fulfillment should fail
      await expectRejectedWith(
        program.methods
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
          .rpc(),
        "BadState"
      );
    });
  });
});
