// The creator-facing portal link: https://collab.promunch.in/<deal code>.
// Same host the WhatsApp template buttons use (edge _shared/influencers.ts
// portalUrl). The middleware rewrites it to /c/<code> (src/lib/collab-host.ts).

export const COLLAB_URL = (process.env.NEXT_PUBLIC_COLLAB_URL || "https://collab.promunch.in").replace(/\/+$/, "");

export function creatorPortalUrl(code: string): string {
  return `${COLLAB_URL}/${encodeURIComponent(code)}`;
}
