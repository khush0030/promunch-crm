import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withBotId } from "botid/next/config";

// Security headers applied to every response (audit L3). Deliberately avoids a
// restrictive script-src CSP (which would need nonces and risk breaking the
// app); clickjacking is covered by frame-ancestors 'none' + X-Frame-Options.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Sentry build plugin. Source-map upload only runs when SENTRY_AUTH_TOKEN +
// org/project are set; without them the build still succeeds (no upload). The
// runtime SDK stays disabled until a DSN is set (see sentry.*.config.ts).
// withBotId adds the proxy rewrites BotID needs (M1 rate-limiting / bot
// protection). Composed inside the Sentry wrapper.
export default withSentryConfig(withBotId(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
