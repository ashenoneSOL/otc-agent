import { NextResponse } from "next/server";
import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localhost } from "viem/chains";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import fs from "fs";
import path from "path";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not available in production" },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const { chain, recipient, amount, token } = body;

    if (!recipient || !amount) {
      return NextResponse.json(
        { error: "Missing recipient or amount" },
        { status: 400 },
      );
    }

    if (chain === "evm") {
      // EVM Logic
      const client = createWalletClient({
        chain: localhost,
        transport: http("http://127.0.0.1:8545"),
      });

      // Use Anvil default account #0
      const account = privateKeyToAccount(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      );

      const tokenAddress =
        token === "usdc"
          ? process.env.NEXT_PUBLIC_USDC_ADDRESS
          : process.env.NEXT_PUBLIC_ELIZAOS_TOKEN_ADDRESS;

      if (!tokenAddress)
        return NextResponse.json(
          { error: "Token address not found in env" },
          { status: 500 },
        );

      // MockERC20 ABI for transfer
      const abi = [
        {
          name: "transfer",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ];

      const decimals = token === "usdc" ? 6 : 18;
      const amountBigInt = parseUnits(amount.toString(), decimals);

      const hash = await client.writeContract({
        chain: localhost,
        account,
        address: tokenAddress as `0x${string}`,
        abi,
        functionName: "transfer",
        args: [recipient, amountBigInt],
      });

      return NextResponse.json({ success: true, tx: hash, chain: "evm" });
    } else if (chain === "solana") {
      // Solana Logic
      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC || "http://127.0.0.1:8899";
      const connection = new Connection(rpcUrl, "confirmed");

      // Try to find id.json
      const idPath = path.join(process.cwd(), "solana/otc-program/id.json");
      if (!fs.existsSync(idPath)) {
        return NextResponse.json(
          { error: "Solana owner key (id.json) not found" },
          { status: 500 },
        );
      }

      const ownerSecret = JSON.parse(fs.readFileSync(idPath, "utf8"));
      const owner = Keypair.fromSecretKey(Uint8Array.from(ownerSecret));

      const mintAddress =
        token === "usdc"
          ? process.env.NEXT_PUBLIC_SOLANA_USDC_MINT
          : process.env.NEXT_PUBLIC_SOLANA_TOKEN_MINT;

      if (!mintAddress)
        return NextResponse.json(
          { error: "Token mint not found in env" },
          { status: 500 },
        );

      const mint = new PublicKey(mintAddress);
      const recipientPubkey = new PublicKey(recipient);

      const recipientAta = await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        mint,
        recipientPubkey,
      );

      const decimals = token === "usdc" ? 6 : 9;
      const amountBigInt = BigInt(
        Math.floor(parseFloat(amount) * Math.pow(10, decimals)),
      );

      const tx = await mintTo(
        connection,
        owner,
        mint,
        recipientAta.address,
        owner,
        amountBigInt,
      );

      return NextResponse.json({ success: true, tx, chain: "solana" });
    }

    return NextResponse.json({ error: "Invalid chain" }, { status: 400 });
  } catch (e: any) {
    console.error("Mint error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
