// Pure helpers for posting a public reply to a Judge.me review
// (POST /api/orm/mentions/[id]/reply). Unit-tested.
//
// Judge.me API (OpenAPI at https://judge.me/api/docs.yaml, verified Oct 9 2026):
//   POST https://api.judge.me/api/v1/replies?shop_domain=<shop>
//   X-Api-Token: <private API token>
//   { "review_id": <Judge.me review id>, "send_reply_email": bool, "reply": { "content": "..." } }
//   200 = created, 422 = { error }.
// The review id is orm_mentions.external_id for source judgeme (the collector
// stores Judge.me's review.id there).

import { applyBrandRules } from "./reply";

export const JUDGEME_API = "https://api.judge.me/api/v1";
export const JUDGEME_DEFAULT_SHOP = "a1e4f4-2.myshopify.com";
export const JUDGEME_REPLY_MAX = 2000;

/**
 * Judge.me emails the reviewer about the reply by default. We turn that off:
 * the public reply is the message, and a second channel (email) to the same
 * customer is not something the team asked for.
 */
export const SEND_REPLY_EMAIL = false;

export function judgemeReviewId(externalId: string | null | undefined): number | null {
  const t = String(externalId ?? "").trim();
  if (!/^\d{1,15}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Brand rules (PROMUNCH caps, no em dashes) + length check. */
export function prepareReplyText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Write the reply first" };
  const text = applyBrandRules(raw);
  if (!text) return { ok: false, error: "Write the reply first" };
  if (text.length > JUDGEME_REPLY_MAX) return { ok: false, error: `Keep the reply under ${JUDGEME_REPLY_MAX} characters` };
  return { ok: true, text };
}

export function buildJudgemeReplyRequest(a: { shop: string; token: string; reviewId: number; content: string }): {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
} {
  return {
    url: `${JUDGEME_API}/replies?shop_domain=${encodeURIComponent(a.shop)}`,
    init: {
      method: "POST",
      headers: { "X-Api-Token": a.token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ review_id: a.reviewId, send_reply_email: SEND_REPLY_EMAIL, reply: { content: a.content } }),
    },
  };
}

/** Best-effort id of the created reply (the 200 body is not documented). */
export function replyExternalId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const reply = o.reply && typeof o.reply === "object" ? (o.reply as Record<string, unknown>) : null;
  const id = reply?.id ?? o.id ?? null;
  return id == null ? null : String(id).slice(0, 100);
}

/** Plain-English error from a failed Judge.me call. */
export function judgemeError(status: number, json: unknown): string {
  const msg =
    json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
      ? (json as { error: string }).error
      : null;
  if (status === 401 || status === 403) return "Judge.me refused the API token. Check the Judge.me key in Settings, API keys.";
  return `Judge.me did not post the reply (HTTP ${status}${msg ? `: ${msg.slice(0, 200)}` : ""}).`;
}

/** What to tell the teammate when the one-reply-per-mention claim already exists. */
export function claimConflictMessage(status: string | null | undefined): string {
  if (status === "posted") return "A reply is already posted on the website for this review.";
  if (status === "failed") return "The last try did not post. Use Try again.";
  return "A reply for this review is being posted right now.";
}
