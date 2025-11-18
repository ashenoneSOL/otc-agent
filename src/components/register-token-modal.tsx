"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Dialog, DialogTitle, DialogBody } from "@/components/dialog";
import { Button } from "@/components/button";
import { scanWalletTokens, type ScannedToken } from "@/utils/wallet-token-scanner";
import { findBestPool, validatePoolLiquidity, formatPoolInfo, type PoolInfo } from "@/utils/pool-finder-base";
import { findSolanaOracle, validateSolanaOracle, formatOracleInfo, getSolanaRegistrationCost, type SolanaOracleInfo } from "@/utils/oracle-finder-solana";
import type { Chain } from "@/config/chains";

interface RegisterTokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultChain?: Chain;
}

type Step = "scan" | "select" | "oracle" | "confirm" | "register" | "success";

export function RegisterTokenModal({
  open,
  onOpenChange,
  onSuccess,
  defaultChain = "base",
}: RegisterTokenModalProps) {
  const { user, authenticated } = usePrivy();
  
  const [step, setStep] = useState<Step>("scan");
  const [selectedChain, setSelectedChain] = useState<Chain>(defaultChain);
  const [tokens, setTokens] = useState<ScannedToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<ScannedToken | null>(null);
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [oracleInfo, setOracleInfo] = useState<SolanaOracleInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Get wallet addresses
  const evmAddress = user?.wallet?.address;
  const solanaAccount = user?.linkedAccounts?.find((acc: any) => acc.type === "solana");
  const solanaAddress = solanaAccount && 'address' in solanaAccount ? solanaAccount.address : undefined;

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setStep("scan");
      setTokens([]);
      setSelectedToken(null);
      setPoolInfo(null);
      setOracleInfo(null);
      setError(null);
      setTxHash(null);
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
          transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org"),
        });

        scannedTokens = await scanWalletTokens(address, selectedChain, publicClient as any);
      } else {
        scannedTokens = await scanWalletTokens(address, selectedChain);
      }
      
      if (scannedTokens.length === 0) {
        setError("No tokens found in your wallet. Try adding a token manually below.");
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
    setStep("oracle");

    try {
      if (selectedChain === "base") {
        // Find Uniswap V3 pool
        const pool = await findBestPool(token.address);
        
        if (!pool) {
          throw new Error("No Uniswap V3 pool found for this token");
        }

        const validation = await validatePoolLiquidity(pool);
        if (!validation.valid) {
          throw new Error(validation.warning || "Pool validation failed");
        }

        setPoolInfo(pool);
      } else if (selectedChain === "solana") {
        // Find Solana oracle
        const oracle = await findSolanaOracle(token.address);
        
        if (!oracle) {
          throw new Error("No oracle found for this token");
        }

        const validation = await validateSolanaOracle(oracle);
        if (!validation.valid) {
          throw new Error(validation.message || "Oracle validation failed");
        }

        setOracleInfo(oracle);
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

    try {
      if (selectedChain === "base") {
        await registerBaseToken();
      } else if (selectedChain === "solana") {
        await registerSolanaToken();
      }

      setStep("success");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setStep("confirm");
    } finally {
      setLoading(false);
    }
  };

  // Register token on Base
  const registerBaseToken = async () => {
    if (!selectedToken || !poolInfo) throw new Error("Missing token or pool info");

    // TODO: Integrate with wagmi/viem to call RegistrationHelper contract
    // For now, throw not implemented
    throw new Error("Base registration not yet implemented - contract needs to be deployed");
  };

  // Register token on Solana
  const registerSolanaToken = async () => {
    if (!selectedToken || !oracleInfo) throw new Error("Missing token or oracle info");

    // TODO: Integrate with Solana wallet to call program
    // For now, throw not implemented
    throw new Error("Solana registration not yet implemented - program needs updates");
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
                <label className="text-sm font-medium mb-2 block">Select Chain</label>
                <div className="flex gap-2">
                  <Button
                    {...(selectedChain !== "base" && { outline: true })}
                    onClick={() => setSelectedChain("base")}
                    disabled={!evmAddress}
                  >
                    Base {!evmAddress && "(Not Connected)"}
                  </Button>
                  <Button
                    {...(selectedChain !== "solana" && { outline: true })}
                    onClick={() => setSelectedChain("solana")}
                    disabled={!solanaAddress}
                  >
                    Solana {!solanaAddress && "(Not Connected)"}
                  </Button>
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
                              <div className="text-sm text-zinc-600 dark:text-zinc-400">{token.name}</div>
                              <div className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                                Balance: {(BigInt(token.balance) / BigInt(10 ** token.decimals)).toString()}
                              </div>
                              <div className="text-xs font-mono text-zinc-500 dark:text-zinc-500 mt-1">
                                {token.address.slice(0, 6)}...{token.address.slice(-4)}
                              </div>
                            </div>
                            {token.logoUrl && (
                              <img 
                                src={token.logoUrl} 
                                alt={token.symbol} 
                                className="w-12 h-12 rounded-full ml-3" 
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
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
                        Already registered ({tokens.filter((t) => t.isRegistered).length}):
                      </div>
                      <div className="space-y-1">
                        {tokens
                          .filter((token) => token.isRegistered)
                          .map((token) => (
                            <div
                              key={token.address}
                              className="p-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded flex items-center gap-2"
                            >
                              <span className="text-green-600 dark:text-green-400">✓</span>
                              <span className="font-medium">{token.symbol}</span>
                              <span className="text-zinc-600 dark:text-zinc-400">- {token.name}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-zinc-600 dark:text-zinc-400">
                  <p>No tokens found in your wallet</p>
                  <p className="text-sm mt-1">You can still register a token manually below</p>
                </div>
              )}

              <div className="pt-4 border-t dark:border-zinc-800 space-y-2">
                <div className="text-sm font-medium mb-2">Or enter token address manually:</div>
                <input
                  type="text"
                  placeholder={`Paste ${selectedChain} token address...`}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const address = (e.target as HTMLInputElement).value.trim();
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

              <Button outline onClick={() => setStep("scan")} className="w-full">
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
                    : "Checking Pyth, Jupiter, and Raydium"}
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
                    {poolInfo ? formatPoolInfo(poolInfo) : oracleInfo ? formatOracleInfo(oracleInfo) : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Registration Cost:</span>
                  <span className="text-sm font-mono">{getRegistrationCost()}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button outline onClick={() => setStep("select")} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleRegister} disabled={loading} className="flex-1">
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
