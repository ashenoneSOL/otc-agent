import { type NextRequest, NextResponse } from "next/server";
import {
  checkSolanaConsignmentStatus,
  markConsignmentUnavailable,
} from "../../../../../lib/solana-consignment-checker";
import { ConsignmentDB } from "../../../../../services/database";

/**
 * POST /api/consignments/[id]/sync-status
 *
 * Sync a consignment's database status with its on-chain state.
 * Used when a BadState error is encountered during operations.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: consignmentDbId } = await params;

  if (!consignmentDbId) {
    return NextResponse.json({ error: "Consignment ID is required" }, { status: 400 });
  }

  try {
    // Fetch the consignment from DB
    const consignment = await ConsignmentDB.getConsignment(consignmentDbId);

    // Only sync Solana consignments
    if (consignment.chain !== "solana") {
      return NextResponse.json({
        success: true,
        message: "Non-Solana consignment - no sync needed",
      });
    }

    if (!consignment.contractConsignmentId) {
      return NextResponse.json(
        {
          success: false,
          error: "Consignment missing contractConsignmentId",
        },
        { status: 400 },
      );
    }

    // Check on-chain status
    const status = await checkSolanaConsignmentStatus(consignment.contractConsignmentId);

    if (!status.isActive) {
      // Mark as unavailable in cache
      markConsignmentUnavailable(consignment.contractConsignmentId);

      // Update DB status to withdrawn
      await ConsignmentDB.updateConsignment(consignmentDbId, { status: "withdrawn" });

      console.log(
        `[SyncStatus] Consignment ${consignmentDbId} marked as withdrawn (on-chain isActive=false)`,
      );

      return NextResponse.json({
        success: true,
        synced: true,
        newStatus: "withdrawn",
        onChainActive: false,
      });
    }

    // Consignment is still active on-chain
    return NextResponse.json({
      success: true,
      synced: false,
      onChainActive: true,
      remainingAmount: status.remainingAmount,
    });
  } catch (err) {
    console.error(`[SyncStatus] Error syncing consignment ${consignmentDbId}:`, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
