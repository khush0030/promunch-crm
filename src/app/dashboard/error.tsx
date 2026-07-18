"use client";

// Dashboard-segment error boundary. A render/runtime crash on any dashboard
// page lands here instead of the app-level global-error, so the sidebar and
// layout stay alive and the user can retry or navigate away.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function DashboardError({
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
    <div className="pm-page">
      <div className="pm-empty" style={{ maxWidth: 520, margin: "48px auto" }}>
        <div className="eic">
          <AlertTriangle />
        </div>
        <h3>Something went wrong loading this page</h3>
        <p>
          The rest of the dashboard is still running. Try again, or head back to the overview.
          {error?.message ? (
            <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--pm-hint)", wordBreak: "break-word" }}>
              {error.message}
            </span>
          ) : null}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="pm-btn primary" onClick={() => reset()}>
            <RefreshCw size={15} /> Retry
          </button>
          <Link href="/dashboard" className="pm-btn ghost">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
