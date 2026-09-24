"use client";
import { useEffect } from "react";

// One place that turns "your session ended" into a login redirect.
//
// The middleware answers every dashboard /api/* call with 401 once the session
// expires. Only 9 of the ~50 client files that call /api go through apiFetch
// (which redirects); the rest use a raw fetch and render the 401 body as a
// plain error, so the page sits there showing "unauthorized" with a Retry
// button that can never succeed — which is exactly what an employee hits after
// leaving a tab open. Patching fetch once covers every caller, including any
// written later, without touching 50 files.
//
// Rules: only same-origin /api/* requests, never the auth endpoints, and the
// response is still returned untouched so existing error handling is unchanged.
export default function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status !== 401 || redirecting) return res;

      let path: string;
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(raw, window.location.origin);
        if (u.origin !== window.location.origin) return res;
        path = u.pathname;
      } catch {
        return res;
      }
      // /api/auth/* handles its own 401s (a failed sign-in is not an expiry).
      if (!path.startsWith("/api/") || path.startsWith("/api/auth/")) return res;

      redirecting = true;
      const next = window.location.pathname + window.location.search;
      window.location.assign("/login?next=" + encodeURIComponent(next));
      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
