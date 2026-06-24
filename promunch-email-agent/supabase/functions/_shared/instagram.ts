// Meta Instagram Graph API client (Instagram Messaging + comments).
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
//       https://developers.facebook.com/docs/instagram-platform/webhooks
//
// Required env:
//   INSTAGRAM_USER_ID        — the IG Business account id (used in the /<id>/messages path)
//   INSTAGRAM_ACCESS_TOKEN   — long-lived page/IG token with instagram_manage_messages + _comments
//   INSTAGRAM_VERIFY_TOKEN   — webhook verify token (you choose)
//   INSTAGRAM_APP_SECRET     — app secret, for X-Hub-Signature-256 check
//   INSTAGRAM_GRAPH_VERSION  — optional, defaults to v21.0

const GRAPH = `https://graph.facebook.com/${Deno.env.get("INSTAGRAM_GRAPH_VERSION") ?? "v21.0"}`;

function token(): string {
  const t = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
  if (!t) throw new Error("Missing INSTAGRAM_ACCESS_TOKEN");
  return t;
}

function igUserId(): string {
  const id = Deno.env.get("INSTAGRAM_USER_ID");
  if (!id) throw new Error("Missing INSTAGRAM_USER_ID");
  return id;
}

export interface SendResult {
  message_id: string | null;
  raw: unknown;
  ok: boolean;
  error?: string;
  error_code?: number;
  error_detail?: string;
}

async function postMessages(body: Record<string, unknown>): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/${igUserId()}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as any)?.error ?? {};
    return {
      ok: false,
      message_id: null,
      raw: json,
      error: e?.message ?? `HTTP ${res.status}`,
      error_code: typeof e?.code === "number" ? e.code : undefined,
      error_detail: e?.error_data?.details ?? e?.error_user_msg ?? undefined,
    };
  }
  const id = (json as any)?.message_id ?? (json as any)?.id ?? null;
  return { ok: true, message_id: id, raw: json };
}

// Send a direct message to a user by IGSID (only valid inside the 24h window,
// or as the first reply to a comment via privateReply()).
export function sendDM(igsid: string, text: string): Promise<SendResult> {
  return postMessages({
    recipient: { id: igsid },
    message: { text },
  });
}

// Private Reply — the ONLY official way to initiate a DM. Sends one DM in
// response to a comment on our media, within 7 days of the comment.
export function privateReply(commentId: string, text: string): Promise<SendResult> {
  return postMessages({
    recipient: { comment_id: commentId },
    message: { text },
  });
}

// Mark a thread seen (typing/seen indicator). Best-effort.
export function markSeen(igsid: string): Promise<SendResult> {
  return postMessages({
    recipient: { id: igsid },
    sender_action: "mark_seen",
  });
}

// Public reply to a comment (optional — we prefer privateReply for outreach).
export async function replyToComment(commentId: string, text: string): Promise<SendResult> {
  const res = await fetch(
    `${GRAPH}/${commentId}/replies?message=${encodeURIComponent(text)}&access_token=${encodeURIComponent(token())}`,
    { method: "POST" },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as any)?.error ?? {};
    return { ok: false, message_id: null, raw: json, error: e?.message ?? `HTTP ${res.status}`, error_code: e?.code };
  }
  return { ok: true, message_id: (json as any)?.id ?? null, raw: json };
}

export interface DiscoveryResult {
  followers: number | null;
  media_count: number | null;
  // engagement rate over the most recent posts, as a fraction (0–1)
  engagement_rate: number | null;
  biography: string | null;
  // recent post captions — used for AI niche/brand-fit scoring
  captions: string[];
}

// Business Discovery — OFFICIAL, free public metrics for ANY public business /
// creator account, queried by username. No scraping. Used to score an inbound
// collab inquiry (followers + recent engagement) against the target band.
// Returns nulls on any failure — scoring is best-effort, never blocks a reply.
export async function businessDiscovery(handle: string): Promise<DiscoveryResult> {
  const empty: DiscoveryResult = {
    followers: null, media_count: null, engagement_rate: null, biography: null, captions: [],
  };
  const user = (handle ?? "").replace(/^@/, "").trim();
  if (!user) return empty;
  try {
    const fields =
      `business_discovery.username(${user}){followers_count,media_count,biography,` +
      `media.limit(12){like_count,comments_count,caption}}`;
    const res = await fetch(
      `${GRAPH}/${igUserId()}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token())}`,
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return empty;
    const bd = (json as any)?.business_discovery;
    if (!bd) return empty;
    const followers: number | null = typeof bd.followers_count === "number" ? bd.followers_count : null;
    const media: any[] = bd.media?.data ?? [];
    let er: number | null = null;
    if (followers && media.length) {
      const totalEng = media.reduce(
        (n, m) => n + (Number(m.like_count) || 0) + (Number(m.comments_count) || 0),
        0,
      );
      er = totalEng / media.length / followers;
    }
    const captions = media
      .map((m) => (m.caption ?? "").toString().trim())
      .filter(Boolean)
      .slice(0, 8);
    return {
      followers,
      media_count: typeof bd.media_count === "number" ? bd.media_count : null,
      engagement_rate: er,
      biography: (bd.biography ?? null) || null,
      captions,
    };
  } catch {
    return empty;
  }
}

// HMAC-SHA256 verification of X-Hub-Signature-256 (identical scheme to WhatsApp).
export async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  const secret = Deno.env.get("INSTAGRAM_APP_SECRET");
  if (!secret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
