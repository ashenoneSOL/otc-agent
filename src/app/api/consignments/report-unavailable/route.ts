import { type NextRequest, NextResponse } from "next/server";
import { markConsignmentUnavailable } from "@/lib/solana-consignment-checker";
import { ConsignmentDB } from "@/services/database";

/**
 * POST /api/consignments/report-unavailable
 *
 * Report a consignment as unavailable (e.g., when BadState error is encountered).
 * Updates the server-side cache and optionally marks in DB as withdrawn.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contractConsignmentId, consignmentDbId, chain } = body;

  // Validate required fields
  if (!contractConsignmentId || typeof contractConsignmentId !== "string") {
    return NextResponse.json(
      { error: "contractConsignmentId is required and must be a string" },
      { status: 400 },
    );
  }

  // Only process Solana consignments for now (EVM contracts handle this differently)
  if (chain !== "solana") {
    return NextResponse.json({ success: true, message: "Non-Solana consignment ignored" });
  }

  console.log(`[ReportUnavailable] Marking consignment ${contractConsignmentId} as unavailable`);

  // Mark in the checker cache (prevents showing in listings)
  markConsignmentUnavailable(contractConsignmentId);

  // Update DB if we have the DB ID
  if (consignmentDbId && typeof consignmentDbId === "string") {
    try {
      await ConsignmentDB.updateConsignment(consignmentDbId, { status: "withdrawn" });
      console.log(`[ReportUnavailable] Updated DB status for ${consignmentDbId}`);
    } catch (err) {
      // Don't fail the request if DB update fails
      console.error(`[ReportUnavailable] Failed to update DB for ${consignmentDbId}:`, err);
    }
  }

  return NextResponse.json({
    success: true,
    message: "Consignment marked as unavailable",
  });
}
