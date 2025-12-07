/**
 * Verify mainnet transactions and state
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

async function main() {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // All verified transactions
  const txs = [
    { name: "Token Registration", sig: "342X6nHnkfnpS2Az2nm2D15a9XF7HvpJnRMaCZqBN6kzU6KAY76L2SkiKZBrDTJZB7poqdU91BvHj4P7xVrLQzzq" },
    { name: "Treasury Creation", sig: "4uSuCN1LX11GBaMosDio5PD5Y7BG7XybrKqQhxv7Z5MgskEur9X6jKkUw36t2pUXDT6Xuj9drmt51zCzUyUdTecu" },
    { name: "Price Setting", sig: "4HctPHQeX5DziTMipNpFT7DM3Vf88K4fwiWzSasyMqrR21Re3aTX6wCML7oCHmZXx9LbN35hyrLd648WcdGHWvKS" },
    { name: "Set Desk Limits", sig: "36bzEhvwuZoQEnxfHbiE85ybaKbs1yHDQtWtfmFbcJimAVvnyNoBUwV27Nr4mCirYtLRH29cfXaLhidcDvsgaZ2y" },
    { name: "REAL LISTING #1", sig: "Hrte5sU1AW5cioFS1ZP89BUzBL6FS5bjUQFAqNdVMWGtpxzu2VMSxt3T6Js5XuhfBPftnfvJX9fZwwAWNcLo5iq" },
    { name: "REAL LISTING #2", sig: "44SAWKxA3Yb8PUmmrQG24wPjXWt9WBrYW2jypEYNWfuGHHGAset4c5Hkk32Jzi1Px3gkycQSYDLhmYtZbcgwCF9D" },
    { name: "REAL BUY OFFER", sig: "2V6davtkvv77pSNqkp8cqnBcBNr56oENqRkjeT78wqd2oa9Pj4q3ggDiuYRDqNR4zG7HwubhXzaxNDqkqKhSKHNg" },
    { name: "OFFER APPROVED", sig: "2ugfSaHAKFsnk52hcyEhuQvgkiNs7wDyhC1oLJ7A8ygXHUDBi1nB9TDs3EBXYYRtDGngMYrsmu7Bra79FMLaSrB3" },
  ];

  console.log("=== VERIFYING ON-CHAIN TRANSACTIONS ===\n");

  for (const tx of txs) {
    try {
      const status = await connection.getSignatureStatus(tx.sig);
      const confirmed = status?.value?.confirmationStatus === "finalized" || status?.value?.confirmationStatus === "confirmed";
      console.log(`${confirmed ? "✅" : "❌"} ${tx.name}: ${confirmed ? "CONFIRMED" : "NOT FOUND"}`);
      if (status?.value?.err) console.log(`   Error: ${JSON.stringify(status.value.err)}`);
    } catch (e) {
      console.log(`❌ ${tx.name}: Error - ${e}`);
    }
  }

  // Check desk treasury balance
  console.log("\n=== DESK TREASURY BALANCE ===");
  const treasury = new PublicKey("62Jy7LBLsH2bq1QGKVA7RcAH4wu3GC8jad6ShYwY7cN8");
  try {
    const balance = await connection.getTokenAccountBalance(treasury);
    console.log(`Treasury: ${balance.value.uiAmountString} ELIZAOS`);
  } catch (e) {
    console.log(`Error: ${e}`);
  }

  // Check consignment accounts (LISTINGS)
  console.log("\n=== CONSIGNMENT ACCOUNTS (LISTINGS) ===");
  const consignments = [
    "G5VeKNhAx8oecZotwi51zXZxqzY2HYDyeM34Yje8xvEo",
    "HM7GBPeLSctuXoUmmUdQ3vyHtv1GvoNZRg5UQKxQQYJk"
  ];
  for (const addr of consignments) {
    const info = await connection.getAccountInfo(new PublicKey(addr));
    console.log(`Consignment ${addr.slice(0,8)}...: ${info ? "✅ EXISTS" : "❌ NOT FOUND"} (${info?.data?.length || 0} bytes)`);
  }

  // Check offer accounts (BUYS)
  console.log("\n=== OFFER ACCOUNTS (BUYS) ===");
  const offers = [
    "3PhXzMtpo2D57Ktv4Y1tKYrQ2A7GwnvdadJ1jakHLuZi"
  ];
  for (const addr of offers) {
    const info = await connection.getAccountInfo(new PublicKey(addr));
    console.log(`Offer ${addr.slice(0,8)}...: ${info ? "✅ EXISTS" : "❌ NOT FOUND"} (${info?.data?.length || 0} bytes)`);
  }

  // Check token registry
  console.log("\n=== TOKEN REGISTRY ===");
  const tokenRegistry = new PublicKey("CdAVNLwJuu22mEPNtx2SuzNbJEi4Mxqu1FUFRMvoc5dk");
  const regInfo = await connection.getAccountInfo(tokenRegistry);
  console.log(`Token Registry: ${regInfo ? "✅ EXISTS" : "❌ NOT FOUND"} (${regInfo?.data?.length || 0} bytes)`);
}

main().catch(console.error);

