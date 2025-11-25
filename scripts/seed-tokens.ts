#!/usr/bin/env bun
import fs from "fs";

async function seedTokens() {
  console.log("\n🌱 Seeding multi-token OTC marketplace...\n");
  
  // Wait for frontend
  let retries = 5;
  while (retries > 0) {
    const healthCheck = await fetch("http://localhost:5004/api/devnet/address").catch(() => null);
    if (healthCheck && healthCheck.ok) {
      console.log("✅ Frontend is ready");
      break;
    }
    console.log(`⏳ Waiting for frontend... (${retries} retries left)`);
    await new Promise(r => setTimeout(r, 2000));
    retries--;
  }

  if (retries === 0) {
    console.log("⚠️  Frontend not ready, skipping seed");
    process.exit(0);
  }

  // --- EVM Seeding ---
  const evmDeploymentPath = "./src/config/deployments/local-evm.json";
  if (fs.existsSync(evmDeploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(evmDeploymentPath, "utf8"));
    // Check if deployment is empty (placeholder)
    if (!deployment.contracts || !deployment.contracts.elizaToken) {
        console.log("⚠️  EVM Deployment empty or invalid, skipping EVM seed");
    } else {
        const elizaAddress = deployment.contracts.elizaToken;
        const ownerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Anvil default #0

    console.log(`\n[EVM] Using elizaOS token: ${elizaAddress}`);
    
    // Register Token
    await fetch("http://localhost:5004/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        symbol: "elizaOS",
        name: "elizaOS (EVM)",
        contractAddress: elizaAddress,
        chain: "base",
        decimals: 18,
        logoUrl: "/tokens/eliza.svg",
        description: "The native token of the elizaOS AI agent platform (EVM).",
        website: "https://elizaos.ai",
        twitter: "https://twitter.com/elizaos",
        }),
    }).catch(() => console.log("[EVM] Token may already exist"));

    console.log("✅ [EVM] elizaOS token registered");

    // Create Consignments
    const tokenId = `token-base-${elizaAddress.toLowerCase()}`;
    
    // Negotiable Deal
    await fetch("http://localhost:5004/api/consignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        tokenId,
        consignerAddress: ownerAddress,
        amount: "10000000000000000000000000",
        isNegotiable: true,
        minDiscountBps: 1000,
        maxDiscountBps: 2500,
        minLockupDays: 30,
        maxLockupDays: 365,
        minDealAmount: "1000000000000000000000",
        maxDealAmount: "1000000000000000000000000",
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 1000,
        maxTimeToExecuteSeconds: 1800,
        chain: "base",
        }),
    }).catch(() => console.log("[EVM] Consignment may already exist"));

    console.log("✅ [EVM] Created negotiable elizaOS consignment");

    // Fixed Deal
    await fetch("http://localhost:5004/api/consignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        tokenId,
        consignerAddress: ownerAddress,
        amount: "5000000000000000000000000",
        isNegotiable: false,
        fixedDiscountBps: 1500,
        fixedLockupDays: 180,
        minDiscountBps: 0,
        maxDiscountBps: 0,
        minLockupDays: 0,
        maxLockupDays: 0,
        minDealAmount: "10000000000000000000000",
        maxDealAmount: "5000000000000000000000000",
        isFractionalized: true,
        isPrivate: false,
        maxPriceVolatilityBps: 500,
        maxTimeToExecuteSeconds: 1800,
        chain: "base",
        }),
    }).catch(() => console.log("[EVM] Consignment may already exist"));

    console.log("✅ [EVM] Created fixed-price elizaOS consignment");
    }
  } else {
    console.log("⚠️  EVM Contracts not deployed, skipping EVM seed");
  }

  // --- Solana Seeding ---
  const solDeploymentPath = "./src/config/deployments/local-solana.json";
  if (fs.existsSync(solDeploymentPath)) {
    const solDeployment = JSON.parse(fs.readFileSync(solDeploymentPath, "utf8"));
    const tokenMint = solDeployment.NEXT_PUBLIC_SOLANA_TOKEN_MINT;
    
    if (!tokenMint) {
        console.log("⚠️  Solana Deployment empty, skipping Solana seed");
    } else {
        const ownerKey = solDeployment.NEXT_PUBLIC_SOLANA_DESK_OWNER;

        console.log(`\n[Solana] Using Token Mint: ${tokenMint}`);

        // Register Token
        await fetch("http://localhost:5004/api/tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            symbol: "SOL-TOK",
            name: "Solana Test Token",
            contractAddress: tokenMint,
            chain: "solana",
            decimals: 9,
            logoUrl: "/tokens/solana.svg",
            description: "Test token on Solana Localnet.",
            website: "https://solana.com",
            twitter: "https://twitter.com/solana",
            }),
        }).catch(() => console.log("[Solana] Token may already exist"));

        console.log("✅ [Solana] Token registered");

        const tokenId = `token-solana-${tokenMint}`;

        // Negotiable Deal
        await fetch("http://localhost:5004/api/consignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            tokenId,
            consignerAddress: ownerKey,
            amount: "500000000000", // 500 tokens (9 decimals)
            isNegotiable: true,
            minDiscountBps: 500,
            maxDiscountBps: 2000,
            minLockupDays: 7,
            maxLockupDays: 90,
            minDealAmount: "1000000000", // 1 token
            maxDealAmount: "500000000000", // 500 tokens
            isFractionalized: true,
            isPrivate: false,
            maxPriceVolatilityBps: 1000,
            maxTimeToExecuteSeconds: 3600,
            chain: "solana",
            }),
        }).catch((e) => console.log("[Solana] Consignment creation failed (might exist)", e));

        console.log("✅ [Solana] Created negotiable consignment");
    }
  } else {
    console.log("⚠️  Solana Program not deployed, skipping Solana seed");
  }

  console.log("\n🎉 Multi-token OTC marketplace seeded successfully!");
  console.log("   Visit http://localhost:5004 to see available deals\n");
}

seedTokens().catch((err) => {
  console.error("❌ Seed error:", err);
  process.exit(1);
});
