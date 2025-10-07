import { NextRequest, NextResponse } from "next/server";
import {
  reconciliationService,
  runReconciliationTask,
} from "@/services/reconciliation";

/**
 * POST /api/reconcile - Manually trigger reconciliation
 * GET /api/reconcile - Health check and status
 */

const CRON_SECRET =
  process.env.CRON_SECRET || process.env.RECONCILIATION_SECRET;

export async function GET() {
  // Health check
  const health = await reconciliationService.healthCheck();

  return NextResponse.json({
    service: "reconciliation",
    ...health,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");

  // In production, require auth; in development, allow without it
  if (process.env.NODE_ENV === "production") {
    if (!CRON_SECRET) {
      throw new Error("Server configuration error");
    }

    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      console.warn("[Reconciliation API] Unauthorized access attempt", {
        ip:
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip"),
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "all";

  if (action === "quote") {
    // Reconcile specific quote
    const quoteId = searchParams.get("quoteId");
    if (!quoteId) {
      return NextResponse.json(
        { error: "quoteId parameter required for quote action" },
        { status: 400 },
      );
    }

    const result = await reconciliationService.reconcileQuote(quoteId);
    return NextResponse.json({
      success: true,
      quoteId,
      updated: result.updated,
      message: `Status: ${result.oldStatus} → ${result.newStatus}`,
      timestamp: new Date().toISOString(),
    });
  }

  if (action === "all" || action === "active") {
    // Reconcile all active quotes
    await runReconciliationTask();

    return NextResponse.json({
      success: true,
      action: "reconcile_all",
      message: "Reconciliation task completed",
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json(
    { error: "Invalid action. Use ?action=quote or ?action=all" },
    { status: 400 },
  );
}
