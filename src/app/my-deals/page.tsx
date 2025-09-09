"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/button";
import { Footer } from "@/components/footer";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/table";
import { WalletConnector } from "@/components/wallet-connector";
import { useOTC } from "@/hooks/contracts/useOTC";

function formatDate(tsSeconds: bigint): string {
  const d = new Date(Number(tsSeconds) * 1000);
  return d.toLocaleString();
}

function formatTokenAmount(amountWei: bigint): string {
  const num = Number(amountWei) / 1e18;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default function Page() {
  const { isConnected } = useAccount();
  const { myOffers, claim, isClaiming, isLoading } = useOTC();

  const inProgress = useMemo(
    () =>
      (myOffers ?? []).filter((o) => {
        // In-progress means paid, not fulfilled, not cancelled
        return Boolean(o?.paid) && !o?.fulfilled && !o?.cancelled;
      }),
    [myOffers],
  );

  if (!isConnected) {
    return (
      <>
        <main className="flex-1 min-h-[70vh] flex items-center justify-center">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">My Deals</h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Connect your wallet to view your OTC deals.
            </p>
            <div className="flex items-center justify-center">
              <WalletConnector onConnectionChange={() => {}} showAsButton />
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">My Deals</h1>
          </div>

          {isLoading ? (
            <div className="text-zinc-600 dark:text-zinc-400">Loading deals…</div>
          ) : inProgress.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-zinc-600 dark:text-zinc-400">
              No active deals. Create one from the chat to get started.
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <Table striped>
                <TableHead>
                  <TableRow>
                    <TableHeader>Offer ID</TableHeader>
                    <TableHeader>Amount (ELIZA)</TableHeader>
                    <TableHeader>Created</TableHeader>
                    <TableHeader>Matures</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader className="text-right">Action</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {inProgress.map((o) => {
                    const now = Math.floor(Date.now() / 1000);
                    const matured = Number(o.unlockTime) <= now;
                    const status = matured ? "Ready to withdraw" : "Locked";
                    return (
                      <TableRow key={o.id.toString()}>
                        <TableCell>#{o.id.toString()}</TableCell>
                        <TableCell>{formatTokenAmount(o.tokenAmount)}</TableCell>
                        <TableCell>{formatDate(o.createdAt)}</TableCell>
                        <TableCell>{formatDate(o.unlockTime)}</TableCell>
                        <TableCell>
                          <span
                            className={
                              matured
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-600 dark:text-zinc-400"
                            }
                          >
                            {status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            color={matured ? "emerald" : "zinc"}
                            disabled={!matured || isClaiming}
                            onClick={async () => {
                              await claim(o.id);
                            }}
                          >
                            {matured ? (isClaiming ? "Withdrawing…" : "Withdraw") : "Locked"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}


