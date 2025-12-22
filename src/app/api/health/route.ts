import { NextResponse } from "next/server";

/**
 * Health Check Endpoint
 *
 * Returns basic health status for monitoring and load balancers.
 * Used by:
 * - Vercel health checks
 * - External monitoring (UptimeRobot, etc.)
 * - Container orchestration (k8s readiness/liveness)
 *
 * Checks:
 * - Server is responsive
 * - Environment is configured
 */
export async function GET() {
  const startTime = Date.now();

  // Check critical environment variables are set
  const hasPrivy = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const hasDatabase = !!process.env.POSTGRES_URL;
  const hasNetwork = !!process.env.NEXT_PUBLIC_NETWORK;

  const status = hasPrivy && hasDatabase && hasNetwork ? "healthy" : "degraded";
  const responseTime = Date.now() - startTime;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      checks: {
        privy: hasPrivy ? "configured" : "missing",
        database: hasDatabase ? "configured" : "missing",
        network: hasNetwork ? "configured" : "missing",
      },
      version: process.env.npm_package_version ?? "unknown",
    },
    { status: status === "healthy" ? 200 : 503 },
  );
}
