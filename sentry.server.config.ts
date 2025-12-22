/**
 * Sentry Server Configuration
 * 
 * This file configures Sentry error tracking for the server side (API routes, SSR).
 * Server errors, unhandled exceptions, and performance data are reported.
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

// Only initialize if DSN is configured
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    
    // Performance monitoring - lower rate on server for cost efficiency
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,
    
    // Environment tracking
    environment: process.env.NODE_ENV,
    
    // Filter out non-actionable errors
    ignoreErrors: [
      // Expected validation errors
      "ZodError",
      // Database connection errors during startup
      "ECONNREFUSED",
    ],
    
    // Don't send PII
    sendDefaultPii: false,
    
    // Capture unhandled promise rejections
    integrations: [
      Sentry.captureConsoleIntegration({
        levels: ["error"],
      }),
    ],
  });
}
