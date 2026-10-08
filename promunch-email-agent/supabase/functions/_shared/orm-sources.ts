// deno-lint-ignore-file no-explicit-any -- third-party API JSON is untyped
// ORM (Reputation) collectors. Contract: docs/plans/2026-10-08-orm-build-spec.md §2.
//
// Every adapter returns MentionInput[] (orm_mentions columns minus the
// enrichment/workflow ones) plus the source's new cursor. The normalize*/parse*
// functions are pure and unit-tested with fixture JSON (orm-sources_test.ts);
// the fetch* adapters do the I/O around them.
//
// Fail soft: a source with no credentials returns status 'not_connected' (never
// an error alert). Nothing here sends a message to anyone.
//
// Credentials: app_secrets (Settings → API keys) → env fallback, via
// getAppSecret().

import { getAppSecret } from "./app-secrets.ts";
import { apifyDatasetItems } from "./apify.ts";

export const BODY_MAX = 4000;

// "whatsapp" is not collected: rows are written by the WhatsApp review
// feedback flow (Not happy tap, _shared/review-feedback-flow.ts).
export type SourceKey = "judgeme" | "youtube" | "reddit" | "rss" | "amazon" | "instagram" | "competitors" | "whatsapp";

export interface MentionInput {
  source: SourceKey;
  external_id: string;
  url: string | null;
  author_name: string | null;
  author_handle: string | null;
  author_followers: number | null;
  title: string | null;
  body: string;
  rating: number | null;
  posted_at: string | null;
  is_owned: boolean;
  product_ref: string | null;
  parent_external_id: string | null;
  raw: Record<string, unknown>;
  relevant?: boolean | null; // pre-filter: false = excluded keyword hit
}

export interface OrmSettingsRow {
  alerts_enabled: boolean;
  alert_wa_ids: string[] | null;
  keywords: string[] | null;
  exclude_keywords: string[] | null;
  amazon_asins: string[] | null;
  amazon_reviews_per_asin: number;
  apify_monthly_budget_usd: number | string;
  apify_month: string | null;
  apify_spent_usd: number | string;
  // v2 (20261009100000_orm_v2.sql); optional so a missing column reads as off
  competitor_asins?: Array<{ asin?: string; brand?: string | null; label?: string | null }> | null;
  auto_case_on_negative?: boolean | null;
  weekly_digest_enabled?: boolean | null;
  weekly_digest_dow?: number | null;
  weekly_digest_hour_ist?: number | null;
  spike_alerts_enabled?: boolean | null;
  spike_threshold?: number | null;
  spike_window_days?: number | null;
}

export interface OrmSourceRow {
  key: SourceKey;
  label: string;
  enabled: boolean;
  every_minutes: number;
  config: Record<string, any>;
  cursor: Record<string, any>;
  next_run_at: string;
}

export type CollectStatus = "ok" | "not_connected" | "budget" | "skipped";

export interface CollectResult {
  status: CollectStatus;
  mentions: MentionInput[];
  cursor: Record<string, any>;
  note?: string;
  // amazon + competitors: settings patch (Apify spend bookkeeping)
  settingsPatch?: Partial<Pick<OrmSettingsRow, "apify_month" | "apify_spent_usd">>;
  // competitors only: rows for orm_competitor_snapshots (no mentions)
  snapshots?: CompetitorSnapshot[];
}

// ---------------------------------------------------------------------------
// text helpers (pure)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+[0-9]*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) {
      const n = parseInt(k.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (k.startsWith("#")) {
      const n = parseInt(k.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

/** Strip tags (and decode entities), collapse whitespace, cap at `max` chars. */
export function cleanText(raw: unknown, max = BODY_MAX): string {
  let s = String(raw ?? "");
  // entity-encoded markup (Google Alerts titles) → real markup first
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length > max ? s.slice(0, max) : s;
}

const strOrNull = (v: unknown, max = 300): string | null => {
  const s = cleanText(v, max);
  return s ? s : null;
};

function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// relevance pre-filter (pure)
// ---------------------------------------------------------------------------

export const OWNED_SOURCES: ReadonlySet<SourceKey> = new Set(["judgeme", "amazon"]);

/**
 * Keep a mention if title/body contains a brand keyword (case-insensitive) or
 * it sits on an owned surface (judgeme, amazon, our YouTube videos). A mention
 * that also hits an exclude keyword is kept with relevant=false (hidden from
 * the feed, never enriched or alerted). Returns the filtered list.
 */
export function applyRelevance(
  mentions: MentionInput[],
  keywords: string[] | null | undefined,
  excludeKeywords: string[] | null | undefined,
): MentionInput[] {
  const kw = (keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const ex = (excludeKeywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const out: MentionInput[] = [];
  for (const m of mentions) {
    const hay = `${m.title ?? ""}\n${m.body}`.toLowerCase();
    const owned = m.is_owned || OWNED_SOURCES.has(m.source);
    const hit = kw.some((k) => hay.includes(k));
    if (!owned && !hit) continue;
    const excluded = ex.length > 0 && ex.some((k) => hay.includes(k));
    out.push(excluded ? { ...m, relevant: false } : m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Judge.me (website reviews)
// GET https://judge.me/api/v1/reviews?api_token&shop_domain&per_page&page
// Response: { current_page, per_page, reviews: [{ id, title, body, rating,
//   reviewer: { id, name, email, phone, ... }, product_external_id,
//   product_title, product_handle, source, curated, published, hidden,
//   verified, created_at, updated_at, pictures, ... }] }
// ---------------------------------------------------------------------------

export const JUDGEME_DEFAULT_SHOP = "a1e4f4-2.myshopify.com";
export const STOREFRONT_URL = "https://promunch.in";

export function normalizeJudgeme(review: any): MentionInput | null {
  if (review?.id == null) return null;
  const handle = strOrNull(review.product_handle, 200);
  const r = review.reviewer ?? {};
  return {
    source: "judgeme",
    external_id: String(review.id),
    url: handle ? `${STOREFRONT_URL}/products/${encodeURIComponent(handle)}` : null,
    author_name: strOrNull(r.name, 120),
    author_handle: null,
    author_followers: null,
    title: strOrNull(review.title, 300),
    body: cleanText(review.body),
    rating: numOrNull(review.rating),
    posted_at: isoOrNull(review.created_at),
    is_owned: true,
    product_ref: handle,
    parent_external_id: null,
    // PII (reviewer email/phone, ip_address) deliberately not stored in raw
    raw: {
      product_title: review.product_title ?? null,
      product_external_id: review.product_external_id ?? null,
      verified: review.verified ?? null,
      published: review.published ?? null,
      hidden: review.hidden ?? null,
      source: review.source ?? null,
      reviewer_email_present: !!r.email,
      pictures: Array.isArray(review.pictures) ? review.pictures.length : 0,
    },
  };
}

/** One page of reviews → mentions newer than lastId, plus whether to keep paging. */
export function judgemePage(json: any, lastId: number, perPage: number): {
  mentions: MentionInput[];
  maxId: number;
  more: boolean;
} {
  const reviews: any[] = Array.isArray(json?.reviews) ? json.reviews : [];
  const mentions: MentionInput[] = [];
  let maxId = lastId;
  let sawOld = false;
  for (const rv of reviews) {
    const id = Number(rv?.id);
    if (!Number.isFinite(id)) continue;
    if (id <= lastId) { sawOld = true; continue; }
    maxId = Math.max(maxId, id);
    const m = normalizeJudgeme(rv);
    if (m) mentions.push(m);
  }
  // Newest-first: once a page reaches the cursor there is nothing newer
  // further back. A short page is the last page.
  return { mentions, maxId, more: !sawOld && reviews.length >= perPage };
}

const JUDGEME_PER_PAGE = 100;
const JUDGEME_MAX_PAGES = 5;

export async function fetchJudgeme(src: OrmSourceRow): Promise<CollectResult> {
  const token = await getAppSecret("JUDGEME_API_TOKEN");
  if (!token) return { status: "not_connected", mentions: [], cursor: src.cursor };
  const shop = (await getAppSecret("JUDGEME_SHOP_DOMAIN")) || JUDGEME_DEFAULT_SHOP;
  const lastId = Number(src.cursor?.last_id ?? 0) || 0;

  const all: MentionInput[] = [];
  let maxId = lastId;
  for (let page = 1; page <= JUDGEME_MAX_PAGES; page++) {
    const url = `https://judge.me/api/v1/reviews?api_token=${encodeURIComponent(token)}` +
      `&shop_domain=${encodeURIComponent(shop)}&per_page=${JUDGEME_PER_PAGE}&page=${page}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Judge.me HTTP ${res.status}`);
    const p = judgemePage(await res.json(), lastId, JUDGEME_PER_PAGE);
    all.push(...p.mentions);
    maxId = Math.max(maxId, p.maxId);
    if (!p.more) break;
  }
  return { status: "ok", mentions: all, cursor: { ...src.cursor, last_id: maxId } };
}

// ---------------------------------------------------------------------------
// YouTube Data API v3
//   channels.list part=contentDetails → relatedPlaylists.uploads   (1 unit)
//   playlistItems.list part=contentDetails,snippet maxResults=20    (1 unit)
//   commentThreads.list part=snippet videoId order=time             (1 unit/video)
//   search.list q=PROMUNCH type=video order=date publishedAfter     (100 units)
// ---------------------------------------------------------------------------

export function normalizeYoutubeCommentThread(item: any): MentionInput | null {
  const top = item?.snippet?.topLevelComment;
  const s = top?.snippet ?? {};
  const id = top?.id ?? item?.id;
  const videoId = s.videoId ?? item?.snippet?.videoId;
  if (!id || !videoId) return null;
  return {
    source: "youtube",
    external_id: String(id),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(id)}`,
    author_name: strOrNull(s.authorDisplayName, 120),
    author_handle: strOrNull(s.authorDisplayName, 120),
    author_followers: null,
    title: null,
    body: cleanText(s.textOriginal ?? s.textDisplay),
    rating: null,
    posted_at: isoOrNull(s.publishedAt),
    is_owned: true,
    product_ref: String(videoId),
    parent_external_id: `video:${videoId}`,
    raw: {
      author_channel_id: s.authorChannelId?.value ?? null,
      author_channel_url: s.authorChannelUrl ?? null,
      like_count: s.likeCount ?? null,
      reply_count: item?.snippet?.totalReplyCount ?? null,
    },
  };
}

export function normalizeYoutubeSearchItem(item: any, ownChannelId: string | null): MentionInput | null {
  const videoId = item?.id?.videoId;
  const s = item?.snippet ?? {};
  if (!videoId) return null;
  if (ownChannelId && s.channelId === ownChannelId) return null; // our own upload
  return {
    source: "youtube",
    external_id: `video:${videoId}`,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    author_name: strOrNull(s.channelTitle, 120),
    author_handle: s.channelId ?? null,
    author_followers: null,
    title: strOrNull(s.title, 300),
    body: cleanText(s.description),
    rating: null,
    posted_at: isoOrNull(s.publishedAt),
    is_owned: false,
    product_ref: String(videoId),
    parent_external_id: null,
    raw: { channel_id: s.channelId ?? null },
  };
}

const YT = "https://www.googleapis.com/youtube/v3";
const YT_VIDEOS = 20;

async function ytGet(path: string, params: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${YT}/${path}?${qs}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason ?? json?.error?.message ?? "";
    const err = new Error(`YouTube ${path} HTTP ${res.status} ${reason}`.trim());
    (err as any).reason = reason;
    throw err;
  }
  return json;
}

export async function fetchYoutube(src: OrmSourceRow, now: number): Promise<CollectResult> {
  const key = await getAppSecret("YOUTUBE_API_KEY");
  if (!key) return { status: "not_connected", mentions: [], cursor: src.cursor };
  const channelId: string | null = (src.config?.channel_id ?? "").trim() || null;
  const out: MentionInput[] = [];
  const notes: string[] = [];

  // (a) comments on our latest uploads
  if (channelId) {
    const ch = await ytGet("channels", { part: "contentDetails", id: channelId }, key);
    const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) notes.push("channel not found");
    else {
      const pl = await ytGet("playlistItems", {
        part: "contentDetails",
        playlistId: uploads,
        maxResults: String(YT_VIDEOS),
      }, key);
      const videoIds: string[] = (pl?.items ?? []).map((i: any) => i?.contentDetails?.videoId).filter(Boolean);
      for (const vid of videoIds) {
        try {
          const ct = await ytGet("commentThreads", {
            part: "snippet",
            videoId: vid,
            order: "time",
            maxResults: "50",
            textFormat: "plainText",
          }, key);
          for (const it of ct?.items ?? []) {
            const m = normalizeYoutubeCommentThread(it);
            if (m) out.push(m);
          }
        } catch (e) {
          // commentsDisabled on one video must not fail the source
          if ((e as any)?.reason === "commentsDisabled" || (e as any)?.reason === "videoNotFound") continue;
          throw e;
        }
      }
    }
  } else {
    notes.push("no channel_id configured (own-video comments skipped)");
  }

  // (b) other people's videos mentioning PROMUNCH (comments on them: not in v1)
  const since = src.cursor?.search_after ?? new Date(now - 7 * 86_400_000).toISOString();
  const sr = await ytGet("search", {
    part: "snippet",
    q: String(src.config?.query ?? "PROMUNCH"),
    type: "video",
    order: "date",
    maxResults: "25",
    publishedAfter: new Date(Date.parse(since)).toISOString(),
  }, key);
  for (const it of sr?.items ?? []) {
    const m = normalizeYoutubeSearchItem(it, channelId);
    if (m) out.push(m);
  }
  return {
    status: "ok",
    mentions: out,
    // overlap 1h so a video indexed late is still caught; upsert dedups
    cursor: { ...src.cursor, search_after: new Date(now - 3_600_000).toISOString() },
    note: notes.join("; ") || undefined,
  };
}

// ---------------------------------------------------------------------------
// Reddit search listing (search.json / oauth.reddit.com/search)
// { kind: "Listing", data: { after, children: [{ kind: "t3"|"t1", data: {...} }] } }
// ---------------------------------------------------------------------------

export function normalizeRedditChild(child: any): MentionInput | null {
  const kind = child?.kind;
  const d = child?.data ?? {};
  if (kind !== "t3" && kind !== "t1") return null;
  const name = d.name ?? (d.id ? `${kind}_${d.id}` : null);
  if (!name) return null;
  const isPost = kind === "t3";
  const author = d.author && d.author !== "[deleted]" ? String(d.author) : null;
  return {
    source: "reddit",
    external_id: String(name),
    url: d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url ?? null),
    author_name: author,
    author_handle: author ? `u/${author}` : null,
    author_followers: null,
    title: strOrNull(isPost ? d.title : d.link_title, 300),
    body: cleanText(isPost ? (d.selftext ?? "") : (d.body ?? "")),
    rating: null,
    posted_at: d.created_utc != null ? isoOrNull(Number(d.created_utc) * 1000) : null,
    is_owned: false,
    product_ref: null,
    parent_external_id: isPost ? null : (d.link_id ?? null),
    raw: {
      subreddit: d.subreddit ?? null,
      score: d.score ?? null,
      num_comments: d.num_comments ?? null,
      link_url: isPost && d.url && !d.is_self ? d.url : null,
    },
  };
}

export function normalizeRedditListing(json: any): MentionInput[] {
  const children: any[] = json?.data?.children ?? [];
  return children.map(normalizeRedditChild).filter((m): m is MentionInput => m !== null);
}

const REDDIT_UA = "web:in.promunch.crm.reputation:v1.0 (brand monitoring; contact hello@promunch.in)";

async function redditToken(): Promise<string | null> {
  const id = await getAppSecret("REDDIT_CLIENT_ID");
  const secret = await getAppSecret("REDDIT_CLIENT_SECRET");
  if (!id || !secret) return null;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_UA,
    },
    body: "grant_type=client_credentials",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) throw new Error(`Reddit token HTTP ${res.status}`);
  return String(json.access_token);
}

export async function fetchReddit(src: OrmSourceRow): Promise<CollectResult> {
  const q = String(src.config?.query ?? "promunch");
  const token = await redditToken();
  const base = token ? "https://oauth.reddit.com/search" : "https://www.reddit.com/search.json";
  const headers: Record<string, string> = { "User-Agent": REDDIT_UA };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: MentionInput[] = [];
  // posts, then comments. Comment search (type=comment) is not part of Reddit's
  // documented API; treated as best effort and never fails the source.
  for (const type of ["link", "comment"]) {
    const qs = new URLSearchParams({ q, sort: "new", limit: "50", type, raw_json: "1" });
    const res = await fetch(`${base}?${qs}`, { headers });
    if (!res.ok) {
      if (type === "comment") break;
      throw new Error(`Reddit search HTTP ${res.status}${token ? "" : " (public, no OAuth app set)"}`);
    }
    out.push(...normalizeRedditListing(await res.json().catch(() => ({}))));
  }
  const newest = out.reduce((t, m) => Math.max(t, m.posted_at ? Date.parse(m.posted_at) : 0), 0);
  return {
    status: "ok",
    mentions: out,
    cursor: { ...src.cursor, ...(newest ? { newest_at: new Date(newest).toISOString() } : {}), auth: token ? "oauth" : "public" },
  };
}

// ---------------------------------------------------------------------------
// RSS / Google Alerts (Atom)
// <entry><id/><title type="html"/><link href="https://www.google.com/url?...&url=REAL&..."/>
//   <published/><updated/><content type="html"/><author><name/></author></entry>
// ---------------------------------------------------------------------------

export interface FeedEntry {
  title: string;
  link: string | null;
  published: string | null;
  content: string;
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

/** Parse Atom <entry> (and RSS 2.0 <item> as a fallback). Pure, regex based. */
export function parseFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  const atom = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const e of atom) {
    const href = e.match(/<link\b[^>]*\bhref\s*=\s*"([^"]+)"/i)?.[1] ?? null;
    out.push({
      title: cleanText(tag(e, "title") ?? "", 300),
      link: href ? decodeEntities(href) : null,
      published: isoOrNull(tag(e, "published") ?? tag(e, "updated")),
      content: cleanText(tag(e, "content") ?? tag(e, "summary") ?? ""),
    });
  }
  if (atom.length) return out;
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const it of items) {
    out.push({
      title: cleanText(tag(it, "title") ?? "", 300),
      link: (tag(it, "link") ?? "").trim() || null,
      published: isoOrNull(tag(it, "pubDate") ?? tag(it, "dc:date")),
      content: cleanText(tag(it, "description") ?? ""),
    });
  }
  return out;
}

/** google.com/url?...&url=<real>&... → <real>; anything else unchanged. */
export function unwrapGoogleUrl(link: string): string {
  try {
    const u = new URL(link);
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === "/url") {
      return u.searchParams.get("url") ?? u.searchParams.get("q") ?? link;
    }
  } catch { /* not a URL */ }
  return link;
}

export async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const OWN_HOSTS = ["promunch.in", "trypromunch.in", "promunch.myshopify.com", "a1e4f4-2.myshopify.com"];

export async function normalizeFeedEntry(e: FeedEntry, feedUrl: string): Promise<MentionInput | null> {
  if (!e.link) return null;
  const url = unwrapGoogleUrl(e.link);
  let host: string | null = null;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep null */ }
  // Our own pages (storefront blog, outreach domain) are not reputation.
  if (host && OWN_HOSTS.some((h) => host === h || host!.endsWith(`.${h}`))) return null;
  return {
    source: "rss",
    external_id: await sha1Hex(url),
    url,
    author_name: host,
    author_handle: null,
    author_followers: null,
    title: e.title || null,
    body: e.content,
    rating: null,
    posted_at: e.published,
    is_owned: false,
    product_ref: null,
    parent_external_id: null,
    raw: { feed: feedUrl },
  };
}

export async function fetchRss(src: OrmSourceRow): Promise<CollectResult> {
  const feeds: string[] = (Array.isArray(src.config?.feeds) ? src.config.feeds : [])
    .map((f: unknown) => String(f ?? "").trim()).filter((f: string) => /^https?:\/\//i.test(f));
  if (!feeds.length) return { status: "not_connected", mentions: [], cursor: src.cursor, note: "no feeds configured" };
  const out: MentionInput[] = [];
  const errors: string[] = [];
  for (const f of feeds.slice(0, 20)) {
    try {
      const res = await fetch(f, { headers: { Accept: "application/atom+xml, application/rss+xml, text/xml" } });
      if (!res.ok) { errors.push(`HTTP ${res.status}`); continue; }
      for (const e of parseFeed(await res.text())) {
        const m = await normalizeFeedEntry(e, f);
        if (m) out.push(m);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length === feeds.length) throw new Error(`all feeds failed: ${errors[0]}`);
  return { status: "ok", mentions: out, cursor: src.cursor, note: errors.length ? `${errors.length} feed(s) failed` : undefined };
}

// ---------------------------------------------------------------------------
// Amazon reviews via Apify
//
// Actor: junglee/amazon-reviews-scraper (Apify's own, ~15k users).
// Switched Oct 9 2026 from axesso_data/amazon-reviews-scraper: axesso exits
// with "Actor usage only allowed for paying user" on the FREE Apify plan
// (run SUCCEEDED, 0 items, $0), and PROMUNCH runs on the free plan.
// Price on the free tier: $0.006 per review ("result") + $0.0013 per result
// when reviewsCutoffDate is set ("dateFilterNewerThan"). The cut-off date =
// newest review we already have minus 1 day, so weekly runs pay only for new
// reviews.
// Input: { productUrls:[{url}], maxReviews (per product), sort:'recent',
//          reviewsCutoffDate:'YYYY-MM-DD', includeGdprSensitive:false }
// Output item: { reviewId, productAsin, reviewTitle, reviewDescription,
//   ratingScore, date, reviewUrl, reviewedIn, variant, isVerified }
// ---------------------------------------------------------------------------

export const AMAZON_ACTOR = "junglee/amazon-reviews-scraper";
// per review on the FREE tier incl. the date-filter event (Oct 2026)
export const AMAZON_ACTOR_PRICE_USD = 0.0073;
export const AMAZON_CONSERVATIVE_PRICE_USD = 0.0073;
const APIFY = "https://api.apify.com/v2";

/** 'YYYY-MM' in IST. */
export function istMonth(t: number): string {
  return new Date(t + 330 * 60_000).toISOString().slice(0, 7);
}

export function amazonPlan(asins: string[], perAsin: number): { perAsin: number; maxReviews: number; estimateUsd: number } {
  const per = Math.max(1, Math.floor(perAsin));
  const maxReviews = asins.length * per;
  const price = Math.max(AMAZON_ACTOR_PRICE_USD, AMAZON_CONSERVATIVE_PRICE_USD);
  return { perAsin: per, maxReviews, estimateUsd: Math.round(maxReviews * price * 10_000) / 10_000 };
}

/**
 * Apify's FREE plan returns at most 10 reviews per run whatever the input
 * ("To access more reviews in a single run, upgrade to the Starter plan",
 * verified Oct 9 2026). So each collection covers ONE ASIN, rotating through
 * the list; with every_minutes = 10080 / ASIN count each product is checked
 * once a week. Pure.
 */
export function amazonNextAsin(asins: string[], idx: unknown): { asin: string; nextIdx: number } {
  const i = Number.isInteger(idx) && (idx as number) >= 0 ? (idx as number) % asins.length : 0;
  return { asin: asins[i], nextIdx: (i + 1) % asins.length };
}

/** Run input for junglee/amazon-reviews-scraper (pure). */
export function amazonRunInput(asins: string[], perAsin: number, newestPostedAt: string | null | undefined): Record<string, unknown> {
  const input: Record<string, unknown> = {
    productUrls: asins.map((a) => ({ url: `https://www.amazon.in/dp/${a}` })),
    // maxReviews is a TOTAL across all productUrls (verified Oct 9 2026: 10
    // → all 10 from the first ASIN), so ask for perAsin x products.
    maxReviews: perAsin * asins.length,
    sort: "recent",
    includeGdprSensitive: false,
    deduplicateRedirectedAsins: true,
  };
  const t = newestPostedAt ? Date.parse(newestPostedAt) : NaN;
  if (Number.isFinite(t)) input.reviewsCutoffDate = new Date(t - 86_400_000).toISOString().slice(0, 10);
  return input;
}

/**
 * Hard budget guard (pure). Resets spend when the stored month is not the
 * current IST month. ok=false → the run must not start.
 */
export function amazonBudget(settings: Pick<OrmSettingsRow, "apify_month" | "apify_spent_usd" | "apify_monthly_budget_usd">, month: string, estimateUsd: number): {
  ok: boolean;
  spent: number;
  budget: number;
  remaining: number;
  monthReset: boolean;
} {
  const monthReset = settings.apify_month !== month;
  const spent = monthReset ? 0 : Number(settings.apify_spent_usd ?? 0) || 0;
  const budget = Number(settings.apify_monthly_budget_usd ?? 0) || 0;
  const remaining = Math.max(0, budget - spent);
  return { ok: spent + estimateUsd <= budget, spent, budget, remaining, monthReset };
}

export function cleanAsins(asins: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const a of asins ?? []) {
    const s = String(a ?? "").trim().toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(s)) seen.add(s);
  }
  return [...seen];
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "Reviewed in India on 5 October 2026" / "2026-10-05" / ISO → ISO (UTC midnight). */
export function parseAmazonDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    return new Date(Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]))).toISOString();
  }
  const us = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (us && MONTHS[us[1].toLowerCase()] != null) {
    return new Date(Date.UTC(Number(us[3]), MONTHS[us[1].toLowerCase()], Number(us[2]))).toISOString();
  }
  return isoOrNull(s);
}

export function normalizeAmazonReview(item: any): MentionInput | null {
  const id = item?.reviewId ?? item?.id;
  if (!id) return null;
  const asin = item?.asin ?? item?.productAsin ?? null;
  const ratingRaw = item?.rating ?? item?.ratingScore ?? item?.stars;
  const rating = numOrNull(typeof ratingRaw === "string" ? ratingRaw.match(/[\d.]+/)?.[0] : ratingRaw);
  return {
    source: "amazon",
    external_id: String(id),
    url: item?.reviewUrl ?? `https://www.amazon.in/gp/customer-reviews/${encodeURIComponent(String(id))}`,
    author_name: strOrNull(item?.userName ?? item?.author ?? item?.reviewerName, 120),
    author_handle: null,
    author_followers: null,
    title: strOrNull(String(item?.title ?? item?.reviewTitle ?? "").replace(/^\s*\d(?:\.\d)? out of 5 stars\s*/i, ""), 300),
    body: cleanText(item?.text ?? item?.reviewDescription ?? item?.body ?? ""),
    rating: rating != null && rating >= 0 && rating <= 5 ? rating : null,
    posted_at: parseAmazonDate(item?.date ?? item?.reviewDate),
    is_owned: true,
    product_ref: asin ? String(asin) : null,
    parent_external_id: null,
    raw: {
      verified: item?.verified ?? item?.isVerified ?? null,
      helpful: item?.numberOfHelpful ?? null,
      product_title: item?.productTitle ?? null,
      variant: Array.isArray(item?.variationList) ? item.variationList.join(", ") : (item?.variant ?? null),
      images: Array.isArray(item?.imageUrlList) ? item.imageUrlList.length : 0,
    },
  };
}

/** Real cost of a finished run: the largest of platform usage and PPE events. */
export function apifyRunCost(run: any, itemCount: number): number {
  const usage = Number(run?.usageTotalUsd ?? 0) || 0;
  const events = run?.chargedEventCounts ?? {};
  const evCount = Number(events.review ?? events.result ?? 0) || 0;
  const ppe = Math.max(evCount, itemCount) * AMAZON_ACTOR_PRICE_USD;
  return Math.round(Math.max(usage, ppe) * 10_000) / 10_000;
}

async function apifyToken(): Promise<string | null> {
  return await getAppSecret("APIFY_TOKEN");
}

async function apifyGetRun(token: string, runId: string): Promise<any> {
  const res = await fetch(`${APIFY}/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Apify run status HTTP ${res.status}`);
  return json?.data ?? {};
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const AMAZON_WAIT_MS = 60_000;

/**
 * Amazon collector. One Apify run at a time: a run still going when the edge
 * call has to return is parked in cursor.pending_run and finished on a later
 * tick (next_run_at is then soon, see orm-tick). Spend is booked on finish.
 */
export async function fetchAmazon(src: OrmSourceRow, settings: OrmSettingsRow, now: number): Promise<CollectResult> {
  const token = await apifyToken();
  if (!token) return { status: "not_connected", mentions: [], cursor: src.cursor };
  const month = istMonth(now);
  const cursor = { ...src.cursor };

  let runId: string | null = cursor.pending_run?.id ?? null;
  if (!runId) {
    const all = cleanAsins(settings.amazon_asins);
    if (!all.length) return { status: "not_connected", mentions: [], cursor, note: "no ASINs configured" };
    const pick = amazonNextAsin(all, cursor.asin_idx);
    const asins = [pick.asin];
    const plan = amazonPlan(asins, Math.min(10, settings.amazon_reviews_per_asin));
    const b = amazonBudget(settings, month, plan.estimateUsd);
    if (!b.ok) {
      return {
        status: "budget",
        mentions: [],
        cursor,
        note: `estimate $${plan.estimateUsd} + spent $${b.spent} > budget $${b.budget}`,
        settingsPatch: b.monthReset ? { apify_month: month, apify_spent_usd: 0 } : undefined,
      };
    }
    const newestByAsin = (cursor.newest_by_asin ?? {}) as Record<string, string>;
    const input = amazonRunInput(asins, plan.perAsin, newestByAsin[pick.asin]);
    // maxTotalChargeUsd: platform-side cap on pay-per-event charges for this
    // run, set to what is left of the monthly budget (belt and braces).
    const qs = new URLSearchParams({
      token,
      maxItems: String(plan.maxReviews),
      maxTotalChargeUsd: b.remaining.toFixed(4),
    });
    const res = await fetch(`${APIFY}/acts/${AMAZON_ACTOR.replace("/", "~")}/runs?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Apify start HTTP ${res.status}: ${json?.error?.message ?? "unknown"}`);
    runId = String(json?.data?.id ?? "");
    if (!runId) throw new Error("Apify start returned no run id");
    cursor.pending_run = { id: runId, asin: pick.asin, started_at: new Date(now).toISOString(), estimate_usd: plan.estimateUsd };
    cursor.asin_idx = pick.nextIdx;
  }

  // wait (bounded) for the run
  const deadline = Date.now() + AMAZON_WAIT_MS;
  let run = await apifyGetRun(token, runId);
  while (!TERMINAL.has(String(run?.status)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    run = await apifyGetRun(token, runId);
  }
  if (!TERMINAL.has(String(run?.status))) {
    return { status: "skipped", mentions: [], cursor, note: `Apify run ${runId} still ${run?.status}` };
  }

  const items = run.defaultDatasetId && run.status === "SUCCEEDED"
    ? await apifyDatasetItems(run.defaultDatasetId, 2000)
    : [];
  const mentions = items.map(normalizeAmazonReview).filter((m): m is MentionInput => m !== null);
  const cost = apifyRunCost(run, items.length);
  const b = amazonBudget(settings, month, 0);
  const runAsin: string | null = cursor.pending_run?.asin ?? null;
  delete cursor.pending_run;
  cursor.last_run = { id: runId, asin: runAsin, status: run.status, cost_usd: cost, items: items.length };
  const newest = mentions.map((m) => m.posted_at).filter((d): d is string => !!d).sort().pop();
  if (runAsin && newest) {
    const by = { ...(cursor.newest_by_asin ?? {}) } as Record<string, string>;
    if (!by[runAsin] || newest > by[runAsin]) by[runAsin] = newest;
    cursor.newest_by_asin = by;
  }
  if (run.status !== "SUCCEEDED") {
    // still book what it cost, then surface as an error
    return {
      status: "ok",
      mentions,
      cursor,
      note: `Apify run ${run.status}`,
      settingsPatch: { apify_month: month, apify_spent_usd: Math.round((b.spent + cost) * 10_000) / 10_000 },
    };
  }
  return {
    status: "ok",
    mentions,
    cursor,
    settingsPatch: { apify_month: month, apify_spent_usd: Math.round((b.spent + cost) * 10_000) / 10_000 },
  };
}

// ---------------------------------------------------------------------------
// Competitor benchmark via Apify (v2 spec §6)
//
// Actor: junglee/Amazon-crawler ("Amazon Product Scraper", Apify's own, same
// publisher as the reviews actor that runs on our FREE plan; ~25k users,
// not deprecated, no paid-only notice; checked Oct 9 2026 via
// api.apify.com/v2/acts/junglee~Amazon-crawler). Pay per event, FREE tier:
// $0.005 per result. Extra events we never trigger: offer/seller ($0.0025,
// maxOffers 0 + scrapeSellers false) and deliveryLocation ($0.06 per result,
// so countryCode/zipCode are NEVER set).
// Input: { categoryOrProductUrls:[{url:'https://www.amazon.in/dp/<asin>'}],
//          maxItemsPerStartUrl:1, ... }
// Output item: { asin, title, brand, url, stars, reviewsCount,
//   price:{value,currency}, listPrice, starsBreakdown, inStock }
// At most 10 ASINs per run (the free plan caps runs at ~10 results; the
// reviews actor proved that); longer lists rotate in batches 15 min apart.
// Budget: the same monthly Apify budget + maxTotalChargeUsd as Amazon reviews.
// ---------------------------------------------------------------------------

export const COMPETITOR_ACTOR = "junglee/Amazon-crawler";
export const COMPETITOR_PRICE_USD = 0.005;
export const COMPETITOR_MAX_PER_RUN = 10;
export const OURS_TOP_N = 3;

export interface CompetitorTarget {
  asin: string;
  brand: string | null;
  label: string | null;
  is_ours: boolean;
}

export interface CompetitorSnapshot extends CompetitorTarget {
  rating: number | null;
  review_count: number | null;
  price_inr: number | null;
  taken_on: string; // YYYY-MM-DD (IST)
  raw: Record<string, unknown>;
}

/** Our top 3 ASINs (is_ours) then the competitor list; de-duped, ours wins. Pure. */
export function competitorTargets(settings: Pick<OrmSettingsRow, "amazon_asins" | "competitor_asins">): CompetitorTarget[] {
  const out = new Map<string, CompetitorTarget>();
  for (const asin of cleanAsins(settings.amazon_asins).slice(0, OURS_TOP_N)) {
    out.set(asin, { asin, brand: "PROMUNCH", label: null, is_ours: true });
  }
  const list = Array.isArray(settings.competitor_asins) ? settings.competitor_asins : [];
  for (const c of list) {
    const asin = cleanAsins([String(c?.asin ?? "")])[0];
    if (!asin || out.has(asin)) continue;
    out.set(asin, {
      asin,
      brand: strOrNull(c?.brand, 80),
      label: strOrNull(c?.label, 160),
      is_ours: false,
    });
  }
  return [...out.values()];
}

/** Next batch of ≤10 targets from offset; nextOffset 0 = cycle done. Pure. */
export function competitorBatch<T>(targets: T[], offset: unknown, size = COMPETITOR_MAX_PER_RUN): { batch: T[]; nextOffset: number } {
  const start = Number.isInteger(offset) && (offset as number) > 0 && (offset as number) < targets.length ? offset as number : 0;
  const end = Math.min(targets.length, start + size);
  return { batch: targets.slice(start, end), nextOffset: end >= targets.length ? 0 : end };
}

/** Run input for junglee/Amazon-crawler (pure). */
export function competitorRunInput(asins: string[]): Record<string, unknown> {
  return {
    categoryOrProductUrls: asins.map((a) => ({ url: `https://www.amazon.in/dp/${a}` })),
    maxItemsPerStartUrl: 1,
    maxSearchPagesPerStartUrl: 1,
    scrapeProductDetails: true,
    maxProductVariantsAsSeparateResults: 0,
    scrapeProductVariantPrices: false,
    maxOffers: 0,
    scrapeSellers: false,
    useCaptchaSolver: false,
    language: "en",
    // never countryCode / zipCode: $0.06 extra per result
  };
}

function firstNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** INR price from {value,currency} | number | "₹1,299.00"; other currencies → null. */
export function parseInrPrice(p: unknown): number | null {
  if (p == null) return null;
  let value: unknown = p;
  let currency = "";
  if (typeof p === "object") {
    value = (p as any).value ?? (p as any).amount ?? null;
    currency = String((p as any).currency ?? "");
  } else if (typeof p === "string") {
    currency = p.replace(/[\d.,\s]/g, "");
  }
  if (currency && !/^(₹|inr|rs\.?)$/i.test(currency.trim())) return null;
  const n = firstNumber(value);
  return n != null && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

export function asinFromUrl(url: unknown): string | null {
  const m = String(url ?? "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

/** One actor item → one snapshot row for a known target, else null. Pure. */
export function normalizeCompetitorItem(item: any, targets: CompetitorTarget[], takenOn: string): CompetitorSnapshot | null {
  const byAsin = new Map(targets.map((t) => [t.asin, t]));
  const candidates = [
    item?.asin, item?.originalAsin, asinFromUrl(item?.input?.url ?? item?.input), asinFromUrl(item?.url),
  ].map((a) => String(a ?? "").trim().toUpperCase()).filter(Boolean);
  const target = candidates.map((a) => byAsin.get(a)).find(Boolean);
  if (!target) return null;
  const stars = firstNumber(item?.stars ?? item?.rating);
  const reviews = firstNumber(item?.reviewsCount ?? item?.ratingsCount ?? item?.reviewCount);
  return {
    ...target,
    brand: target.brand ?? strOrNull(item?.brand, 80),
    label: target.label ?? strOrNull(item?.title, 160),
    rating: stars != null && stars >= 0 && stars <= 5 ? Math.round(stars * 100) / 100 : null,
    review_count: reviews != null && reviews >= 0 ? Math.floor(reviews) : null,
    price_inr: parseInrPrice(item?.price),
    taken_on: takenOn,
    raw: {
      title: strOrNull(item?.title, 300),
      brand: strOrNull(item?.brand, 80),
      url: strOrNull(item?.url, 500),
      stars_breakdown: item?.starsBreakdown ?? null,
      list_price: parseInrPrice(item?.listPrice),
      in_stock: item?.inStock ?? null,
    },
  };
}

/** Real cost of a finished competitor run (largest of usage and PPE results). */
export function competitorRunCost(run: any, itemCount: number): number {
  const usage = Number(run?.usageTotalUsd ?? 0) || 0;
  const evCount = Number(run?.chargedEventCounts?.result ?? 0) || 0;
  const ppe = Math.max(evCount, itemCount) * COMPETITOR_PRICE_USD;
  return Math.round(Math.max(usage, ppe) * 10_000) / 10_000;
}

/** 'YYYY-MM-DD' in IST. */
export function istDate(t: number): string {
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Competitor collector. Same shape as fetchAmazon: one Apify run at a time,
 * parked in cursor.pending_run if still going; spend booked on finish.
 * cursor.more = another batch is waiting (orm-tick rechecks in 15 min).
 */
export async function fetchCompetitors(src: OrmSourceRow, settings: OrmSettingsRow, now: number): Promise<CollectResult> {
  const token = await apifyToken();
  if (!token) return { status: "not_connected", mentions: [], cursor: src.cursor ?? {}, note: "APIFY_TOKEN not set" };
  const month = istMonth(now);
  const cursor = { ...(src.cursor ?? {}) };
  const targets = competitorTargets(settings);

  let runId: string | null = cursor.pending_run?.id ?? null;
  if (!runId) {
    if (!targets.some((t) => !t.is_ours)) {
      delete cursor.more;
      return { status: "not_connected", mentions: [], cursor, note: "no competitor ASINs configured" };
    }
    const { batch, nextOffset } = competitorBatch(targets, cursor.offset);
    const estimateUsd = Math.round(batch.length * COMPETITOR_PRICE_USD * 10_000) / 10_000;
    const b = amazonBudget(settings, month, estimateUsd);
    if (!b.ok) {
      return {
        status: "budget",
        mentions: [],
        cursor,
        note: `estimate $${estimateUsd} + spent $${b.spent} > budget $${b.budget}`,
        settingsPatch: b.monthReset ? { apify_month: month, apify_spent_usd: 0 } : undefined,
      };
    }
    const qs = new URLSearchParams({
      token,
      maxItems: String(batch.length),
      maxTotalChargeUsd: b.remaining.toFixed(4),
    });
    const res = await fetch(`${APIFY}/acts/${COMPETITOR_ACTOR.replace("/", "~")}/runs?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(competitorRunInput(batch.map((t) => t.asin))),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Apify start HTTP ${res.status}: ${json?.error?.message ?? "unknown"}`);
    runId = String(json?.data?.id ?? "");
    if (!runId) throw new Error("Apify start returned no run id");
    cursor.pending_run = {
      id: runId,
      asins: batch.map((t) => t.asin),
      started_at: new Date(now).toISOString(),
      estimate_usd: estimateUsd,
    };
    cursor.offset = nextOffset;
  }

  const deadline = Date.now() + AMAZON_WAIT_MS;
  let run = await apifyGetRun(token, runId);
  while (!TERMINAL.has(String(run?.status)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    run = await apifyGetRun(token, runId);
  }
  if (!TERMINAL.has(String(run?.status))) {
    return { status: "skipped", mentions: [], cursor, note: `Apify run ${runId} still ${run?.status}` };
  }

  const items = run.defaultDatasetId && run.status === "SUCCEEDED"
    ? await apifyDatasetItems(run.defaultDatasetId, 100)
    : [];
  const takenOn = istDate(now);
  const byAsin = new Map<string, CompetitorSnapshot>();
  for (const it of items) {
    const s = normalizeCompetitorItem(it, targets, takenOn);
    if (s && !byAsin.has(s.asin)) byAsin.set(s.asin, s);
  }
  const snapshots = [...byAsin.values()];
  const cost = competitorRunCost(run, items.length);
  const b = amazonBudget(settings, month, 0);
  const asked: string[] = cursor.pending_run?.asins ?? [];
  delete cursor.pending_run;
  cursor.more = Number(cursor.offset ?? 0) > 0;
  cursor.last_run = {
    id: runId,
    status: run.status,
    cost_usd: cost,
    items: items.length,
    missing: asked.filter((a) => !byAsin.has(a)),
  };
  // the free plan can refuse an actor with a SUCCEEDED, empty run (axesso did)
  const note = run.status !== "SUCCEEDED"
    ? `Apify run ${run.status}`
    : !items.length
    ? "Apify run returned no products (free plan limit or Amazon blocked the run)"
    : undefined;
  return {
    status: "ok",
    mentions: [],
    snapshots,
    cursor,
    note,
    settingsPatch: { apify_month: month, apify_spent_usd: Math.round((b.spent + cost) * 10_000) / 10_000 },
  };
}

// ---------------------------------------------------------------------------
// Instagram / Facebook: phase 3 (Meta app review). Not implemented in v1.
// ---------------------------------------------------------------------------

export function fetchInstagram(src: OrmSourceRow): Promise<CollectResult> {
  return Promise.resolve({ status: "not_connected", mentions: [], cursor: src.cursor, note: "phase 3" });
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

export function collect(src: OrmSourceRow, settings: OrmSettingsRow, now: number): Promise<CollectResult> {
  switch (src.key) {
    case "judgeme": return fetchJudgeme(src);
    case "youtube": return fetchYoutube(src, now);
    case "reddit": return fetchReddit(src);
    case "rss": return fetchRss(src);
    case "amazon": return fetchAmazon(src, settings, now);
    case "instagram": return fetchInstagram(src);
    case "competitors": return fetchCompetitors(src, settings, now);
    case "whatsapp": return Promise.resolve({ status: "skipped", mentions: [], cursor: src.cursor ?? {}, note: "fed by the WhatsApp review ask, not collected" });
    default: return Promise.resolve({ status: "skipped", mentions: [], cursor: src.cursor ?? {}, note: "unknown source" });
  }
}
