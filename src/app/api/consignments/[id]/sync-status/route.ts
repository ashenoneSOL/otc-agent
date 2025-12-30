import { type NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { invalidateConsignmentCache } from "@/lib/cache";
import { ConsignmentService } from "@/services/consignmentService";
import { ConsignmentDB } from "@/services/database";
import type { OTCConsignment } from "@/types";
import { fetchSolanaIdl, SOLANA_DESK, SOLANA_RPC } from "@/utils/solana-otc";

/**
 * POST /api/consignments/[id]/sync-status
 *
 * Syncs the database status with on-chain state for Solana consignments.
 * No authentication required - we verify the on-chain state directly.
 * If on-chain consignment is inactive, marks database as withdrawn.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Fetch consignment from database
  let consignment: OTCConsignment;
  try {
    consignment = await ConsignmentDB.getConsignment(id);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: `Consignment ${id} not found` },
        { status: 404 },
      );
    }
    throw err;
  }

  // Only handle Solana consignments for now
  if (consignment.chain !== "solana") {
    return NextResponse.json(
      { success: false, error: "Status sync only supported for Solana consignments" },
      { status: 400 },
    );
  }

  // Must have on-chain address
  if (!consignment.contractConsignmentId) {
    return NextResponse.json(
      { success: false, error: "Consignment has no on-chain address" },
      { status: 400 },
    );
  }

  // Already withdrawn - nothing to do
  if (consignment.status === "withdrawn") {
    return NextResponse.json({
      success: true,
      message: "Already withdrawn",
      status: "withdrawn",
    });
  }

  // Check on-chain state
  if (!SOLANA_RPC || !SOLANA_DESK) {
    return NextResponse.json(
      { success: false, error: "Solana configuration missing" },
      { status: 500 },
    );
  }

  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const idl = await fetchSolanaIdl();
    const program = new anchor.Program(idl, { connection });

    interface ConsignmentAccountData {
      isActive: boolean;
      remainingAmount: { toString(): string };
    }

    const consignmentPubkey = new PublicKey(consignment.contractConsignmentId);
    const programAccounts = program.account as {
      consignment: {
        fetch: (pubkey: PublicKey) => Promise<ConsignmentAccountData | null>;
      };
    };

    let onChainData: ConsignmentAccountData | null = null;
    try {
      onChainData = await programAccounts.consignment.fetch(consignmentPubkey);
    } catch (fetchErr) {
      // Account might not exist or be closed
      console.log(`[SyncStatus] Could not fetch on-chain data: ${fetchErr}`);
    }

    // If on-chain data is null or inactive, mark as withdrawn
    if (!onChainData || !onChainData.isActive) {
      const service = new ConsignmentService();
      await service.withdrawConsignment(id);
      invalidateConsignmentCache();

      return NextResponse.json({
        success: true,
        message: "Marked as withdrawn (on-chain inactive)",
        status: "withdrawn",
        onChainActive: false,
      });
    }

    // On-chain is still active - update remaining amount if different
    const onChainRemaining = onChainData.remainingAmount.toString();
    if (onChainRemaining !== consignment.remainingAmount) {
      await ConsignmentDB.updateConsignment(id, {
        remainingAmount: onChainRemaining,
      });
      invalidateConsignmentCache();

      return NextResponse.json({
        success: true,
        message: "Updated remaining amount from on-chain",
        status: "active",
        remainingAmount: onChainRemaining,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Already in sync",
      status: "active",
    });
  } catch (err) {
    console.error("[SyncStatus] Error checking on-chain state:", err);
    return NextResponse.json(
      { success: false, error: "Failed to check on-chain state" },
      { status: 500 },
    );
  }
}
