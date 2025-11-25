"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useMultiWallet } from "@/components/multiwallet";
import { useWriteContract, usePublicClient, useChainId } from "wagmi";
import { parseEther, type PublicClient } from "viem";
import Image from "next/image";
import type {
  Wallet as AnchorWallet,
  Idl as AnchorIdl,
} from "@coral-xyz/anchor";
import { Dialog, DialogTitle, DialogBody } from "@/components/dialog";
import { Button } from "@/components/button";
import {
  scanWalletTokens,
  type ScannedToken,
} from "@/utils/wallet-token-scanner";
import {
  findBestPool,
  validatePoolLiquidity,
  formatPoolInfo,
  type PoolInfo,
} from "@/utils/pool-finder-base";
import {
  findBestSolanaPool,
  type SolanaPoolInfo,
} from "@/utils/pool-finder-solana";
import {
  findSolanaOracle,
  validateSolanaOracle,
  formatOracleInfo,
  getSolanaRegistrationCost,
  type SolanaOracleInfo,
} from "@/utils/oracle-finder-solana";
import { checkPriceDivergence } from "@/utils/price-validator";
import type { Chain } from "@/config/chains";
import { useConnection } from "@solana/wallet-adapter-react";

interface RegisterTokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultChain?: Chain;
}

type Step =
  | "scan"
  | "select"
  | "oracle"
  | "confirm"
  | "register"
  | "syncing"
  | "success";

export function RegisterTokenModal({
  open,
  onOpenChange,
  onSuccess,
  defaultChain = "base",
}: RegisterTokenModalProps) {
  const { user, authenticated } = usePrivy();
  const { solanaWallet } = useMultiWallet();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { connection } = useConnection();

  const [step, setStep] = useState<Step>("scan");
  const [selectedChain, setSelectedChain] = useState<Chain>(defaultChain);
  const [tokens, setTokens] = useState<ScannedToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<ScannedToken | null>(null);
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [solanaPoolInfo, setSolanaPoolInfo] = useState<SolanaPoolInfo | null>(
    null,
  );
  const [oracleInfo, setOracleInfo] = useState<SolanaOracleInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>("");

  // Get wallet addresses
  const evmAddress = user?.wallet?.address;
  const solanaAccount = user?.linkedAccounts?.find(
    (acc: any) => acc.type === "solana",
  );
  const solanaAddress =
    solanaAccount && "address" in solanaAccount
      ? solanaAccount.address
      : undefined;

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setStep("scan");
      setTokens([]);
      setSelectedToken(null);
      setPoolInfo(null);
      setOracleInfo(null);
      setError(null);
      setWarning(null);
    }
  }, [open]);

  // Scan wallet for tokens
  const handleScan = async () => {
    setLoading(true);
    setError(null);

    try {
      const address = selectedChain === "solana" ? solanaAddress : evmAddress;

      if (!address) {
        throw new Error(`No ${selectedChain} wallet connected`);
      }

      let scannedTokens: ScannedToken[];

      if (selectedChain === "base") {
        // Create publicClient for Base
        const { createPublicClient, http } = await import("viem");
        const { base } = await import("viem/chains");

        const publicClient = createPublicClient({
          chain: base,
          transport: http(
            process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org",
          ),
        });

        scannedTokens = await scanWalletTokens(
          address,
          selectedChain,
          publicClient as PublicClient,
        );
      } else {
        scannedTokens = await scanWalletTokens(address, selectedChain);
      }

      if (scannedTokens.length === 0) {
        setError(
          "No tokens found in your wallet. Try adding a token manually below.",
        );
        setStep("select");
        return;
      }

      setTokens(scannedTokens);
      setStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan wallet");
    } finally {
      setLoading(false);
    }
  };

  // Select token and find oracle
  const handleSelectToken = async (token: ScannedToken) => {
    setSelectedToken(token);
    setLoading(true);
    setError(null);
    setWarning(null);
    setStep("oracle");

    try {
      if (selectedChain === "base") {
        // Find best pool on current chain (or default to mainnet if not connected to base)
        // Use the actual connected chain ID if we are on Base/Base Sepolia, otherwise default to Mainnet
        const targetChainId =
          chainId === 8453 || chainId === 84532 ? chainId : 8453;
        const pool = await findBestPool(token.address, targetChainId);

        if (!pool) {
          throw new Error(
            "No Uniswap V3 or Aerodrome pool found for this token",
          );
        }

        const validation = await validatePoolLiquidity(pool);
        if (!validation.valid) {
          throw new Error(validation.warning || "Pool validation failed");
        }

        setPoolInfo(pool);

        // Check price divergence
        const priceCheck = await checkPriceDivergence(
          token.address,
          "base",
          pool.priceUsd || 0,
        );
        if (!priceCheck.valid && priceCheck.warning) {
          setWarning(priceCheck.warning);
        }
      } else if (selectedChain === "solana") {
        // Detect cluster from connection endpoint
        // This is a bit heuristic but works for standard RPCs
        const cluster = connection.rpcEndpoint.includes("devnet")
          ? "devnet"
          : "mainnet";

        // Find best on-chain pool first
        const bestPool = await findBestSolanaPool(token.address, cluster);
        if (bestPool) {
          setSolanaPoolInfo(bestPool);
          // We can construct a compatible OracleInfo from this
          setOracleInfo({
            // Map AMM pools (Raydium, PumpSwap) to "raydium" type since they both use pool addresses
            type:
              bestPool.protocol === "Raydium" ||
              bestPool.protocol === "PumpSwap"
                ? "raydium"
                : "jupiter",
            address: bestPool.address,
            poolAddress: bestPool.address,
            liquidity: bestPool.tvlUsd, // Use full TVL as the liquidity metric for validation
            valid: true,
            warning: bestPool.tvlUsd < 10000 ? "Low Liquidity" : undefined,
          });

          // Check price divergence
          const priceCheck = await checkPriceDivergence(
            token.address,
            "solana",
            bestPool.priceUsd || 0,
          );
          if (!priceCheck.valid && priceCheck.warning) {
            setWarning(priceCheck.warning);
          }
        } else {
          // Fallback to old method if no on-chain pool found (e.g. Pyth feed only)
          const oracle = await findSolanaOracle(token.address);
          if (oracle) {
            const validation = await validateSolanaOracle(oracle);
            if (!validation.valid) throw new Error(validation.message);
            setOracleInfo(oracle);
          } else {
            throw new Error("No liquid pool or oracle found for this token");
          }
        }
      }

      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find oracle");
      setStep("select");
    } finally {
      setLoading(false);
    }
  };

  // Register token
  const handleRegister = async () => {
    if (!selectedToken) return;

    setLoading(true);
    setError(null);
    setStep("register");
    setTxHash(null);
    setSyncStatus("");

    try {
      let hash: string;

      if (selectedChain === "base") {
        hash = await registerBaseToken();
      } else if (selectedChain === "solana") {
        hash = await registerSolanaToken();
      } else {
        throw new Error("Unsupported chain");
      }

      setTxHash(hash);

      // Wait for transaction confirmation
      setSyncStatus("Waiting for transaction confirmation...");
      if (publicClient && hash) {
        await publicClient.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
        });
      }

      // Now sync to database immediately
      await syncTokenToDatabase(hash);

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setStep("confirm");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sync token to database immediately after on-chain registration
   */
  const syncTokenToDatabase = async (transactionHash: string) => {
    setStep("syncing");
    setSyncStatus("Syncing token to database...");

    try {
      // Call sync endpoint
      const syncResponse = await fetch("/api/tokens/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain: selectedChain === "base" ? "base" : "solana",
          transactionHash,
        }),
      });

      const syncData = await syncResponse.json();

      if (!syncData.success) {
        throw new Error(syncData.error || "Sync failed");
      }

      // Poll database until token appears (max 30 seconds)
      setSyncStatus("Waiting for token to appear in database...");
      const maxAttempts = 15; // 15 attempts × 2 seconds = 30 seconds max
      let attempts = 0;

      while (attempts < maxAttempts) {
        const chain = selectedChain === "base" ? "base" : "solana";
        const response = await fetch(
          `/api/tokens?chain=${chain}&isActive=true`,
        );
        const data = await response.json();

        if (data.success && data.tokens && selectedToken) {
          const tokenFound = data.tokens.find(
            (t: { contractAddress: string }) =>
              t.contractAddress.toLowerCase() ===
              selectedToken.address.toLowerCase(),
          );

          if (tokenFound) {
            setSyncStatus("Token synced successfully!");
            return; // Success!
          }
        }

        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
      }

      // If we get here, token didn't appear but sync might have succeeded
      // (could be a race condition or the token was already registered)
      console.warn(
        "Token did not appear in database after polling, but sync may have succeeded",
      );
      setSyncStatus("Sync completed (token may already be registered)");
    } catch (err) {
      console.error("Sync error:", err);
      // Don't fail the whole flow - cron job will catch it eventually
      setSyncStatus("Sync in progress (will complete automatically)...");
    }
  };

  // Register token on Base
  const registerBaseToken = async (): Promise<string> => {
    if (!selectedToken || !poolInfo)
      throw new Error("Missing token or pool info");
    if (!evmAddress) throw new Error("No EVM wallet connected");
    if (!writeContractAsync) throw new Error("Wallet not connected");

    const registrationHelperAddress =
      process.env.NEXT_PUBLIC_REGISTRATION_HELPER_ADDRESS;
    if (!registrationHelperAddress) {
      throw new Error("RegistrationHelper contract not configured");
    }

    try {
      const registrationFee = parseEther("0.005"); // 0.005 ETH

      const registrationAbi = [
        {
          name: "registerTokenWithPayment",
          type: "function",
          stateMutability: "payable",
          inputs: [
            { name: "tokenAddress", type: "address" },
            { name: "poolAddress", type: "address" },
          ],
          outputs: [{ name: "oracle", type: "address" }],
        },
      ] as const;

      // Type assertion needed as wagmi's writeContractAsync has complex generics
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await (writeContractAsync as any)({
        address: registrationHelperAddress as `0x${string}`,
        abi: registrationAbi,
        functionName: "registerTokenWithPayment",
        args: [
          selectedToken.address as `0x${string}`,
          poolInfo.address as `0x${string}`,
        ],
        value: registrationFee,
      });

      console.log("Base token registration transaction sent:", hash);
      return hash;
    } catch (error) {
      console.error("Registration failed:", error);
      throw new Error(
        `Registration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  // Register token on Solana
  const registerSolanaToken = async () => {
    if (!selectedToken || !oracleInfo)
      throw new Error("Missing token or oracle info");
    if (!solanaAddress || !solanaWallet)
      throw new Error("No Solana wallet connected");

    try {
      // Import Solana dependencies
      const { Connection, PublicKey, SystemProgram } = await import(
        "@solana/web3.js"
      );
      const { AnchorProvider, Program } = await import("@coral-xyz/anchor");
      // Types are imported at module level

      // Get Solana program ID from environment
      const programId = process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
      if (!programId) {
        throw new Error("Solana program ID not configured");
      }

      // Get desk address from environment
      const deskAddress = process.env.NEXT_PUBLIC_SOLANA_DESK;
      if (!deskAddress) {
        throw new Error("Solana desk address not configured");
      }

      // Get RPC URL
      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        "https://api.mainnet-beta.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      // Create a proper wallet adapter for AnchorProvider
      // Type assertion needed as anchor's Wallet type has changed across versions
      const anchorWallet = {
        publicKey: new PublicKey(solanaAddress),
        signTransaction: solanaWallet.signTransaction,
        signAllTransactions: solanaWallet.signAllTransactions,
      } as AnchorWallet;

      // Create provider with the proper wallet adapter
      const provider = new AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });

      // Load program IDL (in production, this would be loaded from the deployed program)
      // For now, we'll create a minimal interface based on the program structure
      // Type assertion needed as anchor IDL types vary between versions
      const minimalIdl = {
        version: "0.1.0",
        name: "otc",
        address: programId,
        instructions: [
          {
            name: "registerToken",
            accounts: [
              { name: "desk", writable: false, signer: false },
              { name: "owner", writable: true, signer: true },
              { name: "tokenMint", writable: false, signer: false },
              { name: "tokenRegistry", writable: true, signer: false },
              { name: "systemProgram", writable: false, signer: false },
            ],
            args: [{ name: "priceFeedId", type: { array: ["u8", 32] } }],
          },
        ],
        accounts: [],
        types: [],
        events: [],
        errors: [],
        metadata: {
          address: programId,
        },
      } as unknown as AnchorIdl;
      const program = new Program(minimalIdl, provider);

      // Get price feed ID from oracle info
      let priceFeedId: number[] = new Array(32).fill(0);
      let poolAddressArg = new PublicKey("11111111111111111111111111111111"); // System program or null

      if (oracleInfo.type === "pyth" && oracleInfo.feedId) {
        // Convert Pyth feed ID to bytes
        const feedPubkey = new PublicKey(oracleInfo.feedId);
        priceFeedId = Array.from(feedPubkey.toBytes());
      } else if (oracleInfo.type === "raydium" && oracleInfo.poolAddress) {
        // For Raydium, we pass the pool address
        poolAddressArg = new PublicKey(oracleInfo.poolAddress);
      } else {
        // Fallback or error
        throw new Error(
          `Unsupported oracle type for registration: ${oracleInfo.type}`,
        );
      }

      // Create PDA for token registry
      const [tokenRegistryPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_registry"),
          new PublicKey(deskAddress).toBuffer(),
          new PublicKey(selectedToken.address).toBuffer(),
        ],
        new PublicKey(programId),
      );

      // Call the registerToken instruction
      const txHash = await program.methods
        .registerToken(priceFeedId, poolAddressArg)
        .accounts({
          desk: new PublicKey(deskAddress),
          owner: anchorWallet.publicKey,
          tokenMint: new PublicKey(selectedToken.address),
          tokenRegistry: tokenRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Solana token registration successful:", {
        token: selectedToken.address,
        oracleType: oracleInfo.type,
        txHash,
      });

      return txHash;
    } catch (error) {
      console.error("Solana registration failed:", error);
      throw new Error(
        `Solana registration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const getRegistrationCost = () => {
    if (selectedChain === "base") {
      return "0.005 ETH (~$15)";
    } else {
      const cost = getSolanaRegistrationCost();
      return `${cost.sol} SOL (~$${cost.usd})`;
    }
  };

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} size="lg">
      <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-xl">
        <DialogTitle className="mb-4">Register New Token</DialogTitle>

        {/* Chain Selection */}
        {step === "scan" && (
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Select Chain
                </label>
                <div className="flex gap-2">
                  {selectedChain === "base" ? (
                    <Button
                      onClick={() => setSelectedChain("base")}
                      disabled={!evmAddress}
                    >
                      Base {!evmAddress && "(Not Connected)"}
                    </Button>
                  ) : (
                    <Button
                      outline
                      onClick={() => setSelectedChain("base")}
                      disabled={!evmAddress}
                    >
                      Base {!evmAddress && "(Not Connected)"}
                    </Button>
                  )}
                  {selectedChain === "solana" ? (
                    <Button
                      onClick={() => setSelectedChain("solana")}
                      disabled={!solanaAddress}
                    >
                      Solana {!solanaAddress && "(Not Connected)"}
                    </Button>
                  ) : (
                    <Button
                      outline
                      onClick={() => setSelectedChain("solana")}
                      disabled={!solanaAddress}
                    >
                      Solana {!solanaAddress && "(Not Connected)"}
                    </Button>
                  )}
                </div>
              </div>

              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <Button
                onClick={handleScan}
                disabled={loading || !authenticated}
                className="w-full"
              >
                {loading ? "Scanning Wallet..." : "Scan My Wallet"}
              </Button>
            </div>
          </DialogBody>
        )}

        {/* Token Selection */}
        {step === "select" && (
          <DialogBody>
            <div className="space-y-4">
              {tokens.length > 0 ? (
                <>
                  <div className="text-sm font-medium mb-2">
                    Select a token to register:
                  </div>

                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {tokens
                      .filter((token) => !token.isRegistered)
                      .map((token) => (
                        <button
                          key={token.address}
                          onClick={() => handleSelectToken(token)}
                          disabled={loading}
                          className="w-full p-4 text-left border rounded-lg hover:border-orange-500 transition-colors disabled:opacity-50 dark:border-zinc-700"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-medium">{token.symbol}</div>
                              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                {token.name}
                              </div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                                Balance:{" "}
                                {(
                                  BigInt(token.balance) /
                                  BigInt(10 ** token.decimals)
                                ).toString()}
                              </div>
                              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-500 mt-1">
                                {token.address.slice(0, 6)}...
                                {token.address.slice(-4)}
                              </div>
                            </div>
                            {token.logoUrl && (
                              <Image
                                src={token.logoUrl}
                                alt={token.symbol}
                                className="rounded-full ml-3"
                                width={48}
                                height={48}
                                unoptimized
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            )}
                          </div>
                        </button>
                      ))}
                  </div>

                  {tokens.filter((t) => t.isRegistered).length > 0 && (
                    <div className="pt-4 border-t dark:border-zinc-800">
                      <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                        Already registered (
                        {tokens.filter((t) => t.isRegistered).length}):
                      </div>
                      <div className="space-y-1">
                        {tokens
                          .filter((token) => token.isRegistered)
                          .map((token) => (
                            <div
                              key={token.address}
                              className="p-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded flex items-center gap-2"
                            >
                              <span className="text-green-600 dark:text-green-400">
                                ✓
                              </span>
                              <span className="font-medium">
                                {token.symbol}
                              </span>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                - {token.name}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-zinc-600 dark:text-zinc-400">
                  <p>No tokens found in your wallet</p>
                  <p className="text-sm mt-1">
                    You can still register a token manually below
                  </p>
                </div>
              )}

              <div className="pt-4 border-t dark:border-zinc-800 space-y-2">
                <div className="text-sm font-medium mb-2">
                  Or enter token address manually:
                </div>
                <input
                  type="text"
                  placeholder={`Paste ${selectedChain} token address...`}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const address = (
                        e.target as HTMLInputElement
                      ).value.trim();
                      if (address) {
                        handleSelectToken({
                          address,
                          symbol: "UNKNOWN",
                          name: "Unknown Token",
                          balance: "0",
                          decimals: 18,
                          chain: selectedChain,
                          isRegistered: false,
                        });
                      }
                    }
                  }}
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                  Press Enter after pasting the address
                </p>
              </div>

              <Button
                outline
                onClick={() => setStep("scan")}
                className="w-full"
              >
                Back
              </Button>
            </div>
          </DialogBody>
        )}

        {/* Oracle Discovery Loading */}
        {step === "oracle" && (
          <DialogBody>
            <div className="py-8 text-center space-y-4">
              <div className="animate-spin h-12 w-12 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
              <div>
                <div className="font-medium">Finding Price Oracle...</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {selectedChain === "base"
                    ? "Searching Uniswap V3 pools"
                    : "Checking PumpSwap, Raydium, and other pools"}
                </div>
              </div>
            </div>
          </DialogBody>
        )}

        {/* Confirmation */}
        {step === "confirm" && selectedToken && (
          <DialogBody>
            <div className="space-y-4">
              <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Token:</span>
                  <span className="text-sm">{selectedToken.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Chain:</span>
                  <span className="text-sm capitalize">{selectedChain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Oracle:</span>
                  <span className="text-sm">
                    {selectedChain === "base" && poolInfo
                      ? formatPoolInfo(poolInfo)
                      : selectedChain === "solana" && solanaPoolInfo
                        ? `${solanaPoolInfo.protocol} Pool (${solanaPoolInfo.baseToken}) - TVL: $${Math.floor(solanaPoolInfo.tvlUsd).toLocaleString()}`
                        : oracleInfo
                          ? formatOracleInfo(oracleInfo)
                          : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">
                    Registration Cost:
                  </span>
                  <span className="text-sm font-mono">
                    {getRegistrationCost()}
                  </span>
                </div>
              </div>

              {warning && (
                <div className="p-3 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-sm">
                  ⚠️ {warning}
                </div>
              )}

              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  outline
                  onClick={() => setStep("select")}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRegister}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? "Registering..." : "Pay & Register"}
                </Button>
              </div>
            </div>
          </DialogBody>
        )}

        {/* Registration In Progress */}
        {step === "register" && (
          <DialogBody>
            <div className="py-8 text-center space-y-4">
              <div className="animate-spin h-12 w-12 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
              <div>
                <div className="font-medium">Registering Token...</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  Please confirm the transaction in your wallet
                </div>
              </div>
            </div>
          </DialogBody>
        )}

        {/* Syncing */}
        {step === "syncing" && (
          <DialogBody>
            <div className="text-center space-y-4 py-6">
              <div className="animate-spin text-orange-500 text-5xl">⟳</div>
              <div>
                <div className="font-medium text-lg">Syncing Token...</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                  {syncStatus || "Processing registration"}
                </div>
                {txHash && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-2 font-mono break-all">
                    TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                  </div>
                )}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-4">
                This usually takes a few seconds...
              </div>
            </div>
          </DialogBody>
        )}

        {/* Success */}
        {step === "success" && (
          <DialogBody>
            <div className="text-center space-y-4 py-6">
              <div className="text-green-500 text-5xl">✓</div>
              <div>
                <div className="font-medium text-lg">Token Registered!</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {selectedToken?.symbol} is now available for trading
                </div>
                {txHash && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-2 font-mono break-all">
                    TX: {txHash.slice(0, 10)}...{txHash.slice(-8)}
                  </div>
                )}
              </div>
              <Button onClick={() => onOpenChange(false)} className="w-full">
                Close
              </Button>
            </div>
          </DialogBody>
        )}
      </div>
    </Dialog>
  );
}
