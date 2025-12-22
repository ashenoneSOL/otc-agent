/**
 * Sentry Edge Configuration
 * 
 * This file configures Sentry error tracking for edge runtime (middleware, edge API routes).
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

// Only initialize if DSN is configured
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,
    
    // Environment tracking
    environment: process.env.NODE_ENV,
  });
}
