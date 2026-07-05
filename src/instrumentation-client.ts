// Sentry — browser runtime. Loaded automatically by Next.js on the client.
// No-ops when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";

// Vercel BotID (audit M1): attach bot-challenge headers to sensitive,
// browser-initiated mutations. These paths MUST match the server-side
// assertHuman()/checkBotId() calls exactly, or the server check fails.
initBotId({
  protect: [
    { path: "/api/team", method: "POST" },              // invite member
    { path: "/api/team", method: "PATCH" },             // change role
    { path: "/api/team", method: "DELETE" },            // remove member
    { path: "/api/contacts/*/anonymize", method: "POST" }, // GDPR erasure
  ],
});

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // No session replay by default — it can capture PII from the CRM UI.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
