// Sentry — server runtime (Node). Initialised from instrumentation.ts.
// No-ops when SENTRY_DSN is unset, so the app runs fine before Sentry is
// configured; set SENTRY_DSN in Vercel to turn it on.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Never ship customer PII to Sentry — this app handles names/phones/emails.
    sendDefaultPii: false,
  });
}
