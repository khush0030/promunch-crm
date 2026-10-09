// Instagram Graph API Business Discovery for creator scoring: free, official
// public metrics for any public Business/Creator account, by username.
// Rate limit: ~200 calls/hour per app user, so callers batch small.
//
// Creds: INSTAGRAM_ACCESS_TOKEN from app_secrets (Settings → API keys) or env.
// The PROMUNCH IG business id comes from INSTAGRAM_USER_ID if set, else it is
// resolved once from the token's Pages (/me/accounts → instagram_business_account).

import { getAppSecret } from "./app-secrets.ts";
import type { ProfileNorm } from "./apify.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("INSTAGRAM_GRAPH_VERSION") ?? "v21.0"}`;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

let resolved: { token: string; igId: string } | null = null;
let resolvedAt = 0;

export async function igGraphCreds(): Promise<{ token: string; igId: string } | null> {
  if (resolved && Date.now() - resolvedAt < 10 * 60_000) return resolved;
  const token = await getAppSecret("INSTAGRAM_ACCESS_TOKEN");
  if (!token) return null;
  let igId = await getAppSecret("INSTAGRAM_USER_ID");
  if (!igId) {
    const r = await fetch(`${GRAPH}/me/accounts?fields=instagram_business_account{id}&limit=50&access_token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    igId = (d?.data ?? []).map((p: any) => p?.instagram_business_account?.id).find(Boolean) ?? null;
  }
  if (!igId) return null;
  resolved = { token, igId };
  resolvedAt = Date.now();
  return resolved;
}

/** Full profile via Business Discovery, shaped like the Apify normalizer.
 *  null when the account isn't visible (personal/private/unknown) or on error. */
export async function discoverProfile(handle: string): Promise<ProfileNorm | null> {
  const creds = await igGraphCreds();
  const user = (handle ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!creds || !user) return null;
  const fields =
    `business_discovery.username(${user}){username,name,biography,website,profile_picture_url,` +
    `followers_count,media_count,media.limit(12){like_count,comments_count,caption,media_type,timestamp}}`;
  try {
    const res = await fetch(`${GRAPH}/${creds.igId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(creds.token)}`);
    if (!res.ok) return null;
    const bd = (await res.json().catch(() => ({})))?.business_discovery;
    if (!bd || typeof bd.followers_count !== "number") return null;
    const media: any[] = bd.media?.data ?? [];
    const last3 = media.slice(0, 3).map((m) => ({
      likes: typeof m.like_count === "number" ? m.like_count : null,
      comments: typeof m.comments_count === "number" ? m.comments_count : null,
      views: null,
      caption: m.caption ? String(m.caption).slice(0, 300) : null,
      type: m.media_type ?? null,
      taken_at: m.timestamp ?? null,
    }));
    const withEng = last3.filter((p) => p.likes != null || p.comments != null);
    const avgLikes = withEng.length ? withEng.reduce((n, p) => n + (p.likes ?? 0), 0) / withEng.length : null;
    const avgComments = withEng.length ? withEng.reduce((n, p) => n + (p.comments ?? 0), 0) / withEng.length : null;
    const followers: number = bd.followers_count;
    const bio: string | null = bd.biography ?? null;
    return {
      handle: user,
      full_name: bd.name ?? null,
      profile_pic: bd.profile_picture_url ?? null,
      biography: bio,
      external_url: bd.website ?? null,
      followers,
      media_count: typeof bd.media_count === "number" ? bd.media_count : null,
      avg_likes: avgLikes,
      avg_comments: avgComments,
      engagement_rate: followers && avgLikes != null ? ((avgLikes ?? 0) + (avgComments ?? 0)) / followers : null,
      bio_email: bio ? (bio.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null) : null,
      last3,
      captions: media.map((m) => (m.caption ?? "").toString().trim()).filter(Boolean).slice(0, 8).map((c) => c.slice(0, 200)),
      business_category: null,
      is_business: true,
    } as ProfileNorm;
  } catch {
    return null;
  }
}
