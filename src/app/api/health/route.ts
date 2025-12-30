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

  // Database: Check for explicit config OR allow local fallback in development
  const hasExplicitDatabase = !!(
    process.env.DATABASE_POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_DATABASE_URL
  );
  const isDevWithLocalFallback =
    process.env.NODE_ENV === "development" && !hasExplicitDatabase;
  const hasDatabase = hasExplicitDatabase || isDevWithLocalFallback;

  // Network: In development, allow fallback to "local"
  const hasExplicitNetwork = !!process.env.NEXT_PUBLIC_NETWORK;
  const hasNetwork =
    hasExplicitNetwork || process.env.NODE_ENV === "development";

  const status = hasPrivy && hasDatabase && hasNetwork ? "healthy" : "degraded";
  const responseTime = Date.now() - startTime;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      checks: {
        privy: hasPrivy ? "configured" : "missing",
        database: hasExplicitDatabase
          ? "configured"
          : isDevWithLocalFallback
            ? "local-fallback"
            : "missing",
        network: hasExplicitNetwork
          ? "configured"
          : process.env.NODE_ENV === "development"
            ? "dev-fallback"
            : "missing",
      },
      version: process.env.npm_package_version ?? "1.0.0",
    },
    { status: status === "healthy" ? 200 : 503 },
  );
}
