"use client";

// Dashboard-segment error boundary. A render/runtime crash on any dashboard
// page lands here instead of the app-level global-error, so the sidebar and
// layout stay alive and the user can retry or navigate away.
// The raw error goes to Sentry and the console, never onto the screen.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";
import { CloudOff } from "lucide-react";
import s from "../not-found.module.css";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("[dashboard] page crashed", error);
  }, [error]);

  return (
    <div className="pm-page">
      <div className={`${s.card} ${s.inShell}`}>
        <div className={s.empty}>
          <div className={s.art}>
            <CloudOff aria-hidden />
          </div>
          <h1 className={s.title}>Couldn&apos;t load this page</h1>
          <p className={s.text}>Something broke while loading it. Your data is safe, and the rest of the CRM still works.</p>
          <div className={s.actions}>
            <button type="button" className={s.btn} onClick={() => reset()}>
              Try again
            </button>
            <Link href="/dashboard" className={`${s.btn} ${s.btnGhost}`}>
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
