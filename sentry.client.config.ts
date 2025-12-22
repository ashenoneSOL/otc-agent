/**
 * Sentry Client Configuration
 * 
 * This file configures Sentry error tracking for the browser/client side.
 * Errors caught by the React error boundary and unhandled promises are reported.
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Only initialize if DSN is configured
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    
    // Session replay for debugging user interactions
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    
    // Environment and release tracking
    environment: process.env.NODE_ENV,
    
    // Filter out non-actionable errors
    ignoreErrors: [
      // Browser extensions
      "ResizeObserver loop limit exceeded",
      // Network issues
      "Network request failed",
      "Failed to fetch",
      // User aborted
      "AbortError",
      // Wallet connection issues (expected)
      "User rejected",
      "User denied",
    ],
    
    // Don't send PII
    sendDefaultPii: false,
    
    // Integrations
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
  });
}
