// collab.promunch.in: the creator-facing host for the influencer portal.
//
// Creators get `https://collab.promunch.in/<deal code>` in their WhatsApp
// buttons. The same Next.js app serves it, so the middleware routes that host
// here BEFORE any session logic: only the portal page and its public API are
// reachable on it; the dashboard, login and every other route bounce to the
// storefront. The old `<app>/c/<code>` links on the admin host keep working.

import { DEAL_CODE_RE } from "@/lib/influencers/normalize";

export const DEFAULT_COLLAB_HOST = "collab.promunch.in";
export const STOREFRONT_URL = "https://promunch.in";

export function collabHost(): string {
  return (process.env.COLLAB_HOST || DEFAULT_COLLAB_HOST).trim().toLowerCase();
}

/** True when the request is for the creator host (port and case ignored). */
export function isCollabHost(host: string | null | undefined, collab = collabHost()): boolean {
  if (!host) return false;
  return host.split(":")[0].trim().toLowerCase() === collab;
}

export type CollabRoute =
  | { kind: "pass" } // serve as-is (portal API, Next assets)
  | { kind: "rewrite"; pathname: string } // /<code> → /c/<code>
  | { kind: "redirect"; location: string } // relative (same host) or absolute
  | { kind: "not_found" }; // any other /api/* on this host

/** Where a request on collab.promunch.in goes. Pure; tested in collab-host.test.ts. */
export function routeCollab(pathname: string): CollabRoute {
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/pm-logo")) {
    return { kind: "pass" };
  }
  if (pathname.startsWith("/api/public/collab/")) return { kind: "pass" };
  if (pathname.startsWith("/api/")) return { kind: "not_found" };

  const parts = pathname.split("/").filter(Boolean);
  // /<code> → the portal page.
  if (parts.length === 1 && DEAL_CODE_RE.test(parts[0])) {
    return { kind: "rewrite", pathname: `/c/${parts[0]}` };
  }
  // /c/<code> (old link shape) → the short canonical form.
  if (parts.length === 2 && parts[0] === "c" && DEAL_CODE_RE.test(parts[1])) {
    return { kind: "redirect", location: `/${parts[1]}` };
  }
  // Root, dashboard, login, typos: nothing for a creator here.
  return { kind: "redirect", location: STOREFRONT_URL };
}
