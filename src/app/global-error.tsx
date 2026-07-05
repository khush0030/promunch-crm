"use client";

// Top-level React error boundary. Catches render/runtime crashes anywhere in
// the app, reports them to Sentry (no-op without a DSN), and shows a minimal
// recovery screen instead of a blank white page.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 24px", textAlign: "center", color: "#111827" }}>
        <div style={{ maxWidth: 420, margin: "0 auto" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 20 }}>
            The error has been logged. You can try again, or reload the page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "9px 16px", borderRadius: 8, border: "none", background: "#0f766e",
              color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
