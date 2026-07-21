// Apify REST client + defensive normalizers for the Instagram discovery
// actors. Actor output schemas drift, so every normalizer accepts multiple
// field spellings and returns nulls rather than throwing.
//
// Token: APIFY_TOKEN via app_secrets (dashboard-rotatable) → env fallback.

import { getAppSecret } from "./app-secrets.ts";

const API = "https://api.apify.com/v2";

async function apifyToken(): Promise<string> {
  const t = await getAppSecret("APIFY_TOKEN");
  if (!t) throw new Error("APIFY_TOKEN not configured (Settings → API keys)");
  return t;
}

export interface ApifyRunRef {
  runId: string;
  datasetId: string | null;
  status: string;
}

// Actor ids use '/', the REST path wants '~' (apify/instagram-profile-scraper
// → apify~instagram-profile-scraper).
export async function apifyStart(actor: string, input: Record<string, unknown>): Promise<ApifyRunRef> {
  const token = await apifyToken();
  const res = await fetch(`${API}/acts/${actor.replace("/", "~")}/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Apify start failed (${res.status}): ${(json as any)?.error?.message ?? "unknown"}`);
  }
  const d = (json as any)?.data ?? {};
  return { runId: d.id, datasetId: d.defaultDatasetId ?? null, status: d.status ?? "READY" };
}

export interface ApifyRunStatus {
  status: string;                       // READY|RUNNING|SUCCEEDED|FAILED|ABORTED|TIMED-OUT
  datasetId: string | null;
  usageUsd: number | null;
}

export async function apifyRunStatus(runId: string): Promise<ApifyRunStatus> {
  const token = await apifyToken();
  const res = await fetch(`${API}/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Apify run status failed (${res.status})`);
  const d = (json as any)?.data ?? {};
  const usage = typeof d.usageTotalUsd === "number" ? d.usageTotalUsd : null;
  return { status: d.status ?? "UNKNOWN", datasetId: d.defaultDatasetId ?? null, usageUsd: usage };
}

// Paged dataset fetch; caps at maxItems to bound memory + import time.
export async function apifyDatasetItems(datasetId: string, maxItems = 2000): Promise<any[]> {
  const token = await apifyToken();
  const items: any[] = [];
  const PAGE = 500;
  for (let offset = 0; offset < maxItems; offset += PAGE) {
    const res = await fetch(
      `${API}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&clean=true&format=json` +
        `&offset=${offset}&limit=${Math.min(PAGE, maxItems - offset)}`,
    );
    if (!res.ok) throw new Error(`Apify dataset fetch failed (${res.status})`);
    const page = await res.json().catch(() => []);
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    if (page.length < PAGE) break;
  }
  return items;
}

// ---- normalizers ------------------------------------------------------------

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = Number(v);
    if (v != null && Number.isFinite(n)) return n;
  }
  return null;
}

function str(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function cleanHandle(h: string | null): string | null {
  const u = (h ?? "").replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9._]{1,60}$/.test(u) ? u : null;
}

// instagram-search-scraper (user search) / hashtag-scraper (posts): pull out a
// candidate handle wherever the actor put it.
export function extractHandle(item: any): string | null {
  return cleanHandle(
    str(item?.username, item?.ownerUsername, item?.owner?.username, item?.user?.username, item?.name),
  );
}

export interface ProfileNorm {
  handle: string | null;
  full_name: string | null;
  profile_pic: string | null;
  biography: string | null;
  external_url: string | null;
  followers: number | null;
  media_count: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_rate: number | null;    // fraction 0–1 over last 3 posts
  bio_email: string | null;
  last3: { likes: number | null; comments: number | null; views: number | null; caption: string | null; type: string | null; taken_at: string | null }[];
  captions: string[];
}

// instagram-profile-scraper output → our prospect shape.
export function normalizeProfileItem(item: any): ProfileNorm {
  const handle = extractHandle(item);
  const followers = num(item?.followersCount, item?.followers_count, item?.followers);
  const posts: any[] = Array.isArray(item?.latestPosts) ? item.latestPosts : (Array.isArray(item?.posts) ? item.posts : []);
  const last3 = posts.slice(0, 3).map((p) => ({
    likes: num(p?.likesCount, p?.likes_count, p?.likes),
    comments: num(p?.commentsCount, p?.comments_count, p?.comments),
    views: num(p?.videoViewCount, p?.videoPlayCount, p?.video_view_count),
    caption: str(p?.caption)?.slice(0, 300) ?? null,
    type: str(p?.type, p?.mediaType) ?? null,
    taken_at: str(p?.timestamp, p?.taken_at) ?? null,
  }));
  const withEng = last3.filter((p) => p.likes != null || p.comments != null);
  const avgLikes = withEng.length ? withEng.reduce((n, p) => n + (p.likes ?? 0), 0) / withEng.length : null;
  const avgComments = withEng.length ? withEng.reduce((n, p) => n + (p.comments ?? 0), 0) / withEng.length : null;
  const er = followers && avgLikes != null
    ? ((avgLikes ?? 0) + (avgComments ?? 0)) / followers
    : null;
  const bio = str(item?.biography, item?.bio);
  return {
    handle,
    full_name: str(item?.fullName, item?.full_name),
    profile_pic: str(item?.profilePicUrl, item?.profile_pic_url, item?.profilePicUrlHD),
    biography: bio,
    external_url: str(item?.externalUrl, item?.external_url, item?.website),
    followers,
    media_count: num(item?.postsCount, item?.posts_count, item?.mediaCount),
    avg_likes: avgLikes,
    avg_comments: avgComments,
    engagement_rate: er,
    bio_email: bio ? (bio.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null) : null,
    last3,
    captions: posts.slice(0, 8).map((p) => str(p?.caption) ?? "").filter(Boolean).map((c) => c.slice(0, 200)),
  };
}

// instagram-reel-scraper output → avg views for one handle.
export function normalizeReelViews(items: any[]): number | null {
  const views = items
    .map((i) => num(i?.videoViewCount, i?.videoPlayCount, i?.playCount, i?.viewCount))
    .filter((v): v is number => v != null);
  if (!views.length) return null;
  return views.reduce((a, b) => a + b, 0) / views.length;
}
