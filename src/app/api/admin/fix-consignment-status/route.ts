import { type NextRequest, NextResponse } from "next/server";
import { invalidateConsignmentCache } from "../../../../lib/cache";
import { ConsignmentDB, type OTCConsignment } from "../../../../services/database";

/**
 * Fix consignment status when on-chain state doesn't match database
 * POST /api/admin/fix-consignment-status
 */
export async function POST(request: NextRequest) {
  // Require admin authentication
  const adminSecret = process.env.ADMIN_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!adminSecret) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { consignmentId, status, remainingAmount } = body;

  if (!consignmentId || typeof consignmentId !== "string") {
    return NextResponse.json({ error: "consignmentId is required" }, { status: 400 });
  }

  // Get current consignment
  let consignment: OTCConsignment;
  try {
    consignment = await ConsignmentDB.getConsignment(consignmentId);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return NextResponse.json(
        { error: `Consignment ${consignmentId} not found` },
        { status: 404 },
      );
    }
    throw err;
  }

  const updates: Record<string, string | number> = {};

  if (status && typeof status === "string") {
    updates.status = status;
  }

  if (remainingAmount !== undefined) {
    updates.remainingAmount = String(remainingAmount);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const updated = await ConsignmentDB.updateConsignment(consignmentId, updates);

  // Invalidate cache
  invalidateConsignmentCache();

  return NextResponse.json({
    success: true,
    message: `Updated consignment ${consignmentId}`,
    before: {
      status: consignment.status,
      remainingAmount: consignment.remainingAmount,
    },
    after: {
      status: updated.status,
      remainingAmount: updated.remainingAmount,
    },
  });
}
