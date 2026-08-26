// Meta WhatsApp Cloud API client.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Required env:
//   WHATSAPP_PHONE_NUMBER_ID      — sender phone number id (digits)
//   WHATSAPP_ACCESS_TOKEN         — permanent system-user token
//   WHATSAPP_VERIFY_TOKEN         — webhook verify token (you choose)
//   WHATSAPP_APP_SECRET           — app secret, for X-Hub-Signature-256 check
//   WHATSAPP_GRAPH_VERSION        — optional, defaults to v21.0

import { isMarketingTemplate as classifyTemplate } from "./template-category.ts";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0"}`;

function token(): string {
  const t = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!t) throw new Error("Missing WHATSAPP_ACCESS_TOKEN");
  return t;
}

function phoneId(): string {
  const p = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!p) throw new Error("Missing WHATSAPP_PHONE_NUMBER_ID");
  return p;
}

// Which Meta endpoint actually carried the message. Purely observational — it
// is logged, never persisted as a column, so the ledger schema is untouched.
export type WaSendPath = "cloud_api" | "mm_lite";

export interface SendResult {
  message_id: string | null;
  raw: unknown;
  ok: boolean;
  error?: string;
  error_code?: number;   // Meta error.code — drives the failure-alert explainer
  error_detail?: string; // Meta error_data.details / error_user_msg, if present
  // ---- MM Lite observability (all optional; absent on every non-template send
  // and on every send made while WA_MM_LITE_ENABLED is unset) ----------------
  send_path?: WaSendPath;      // "mm_lite" when /marketing_messages carried it
  mm_lite_fallback?: boolean;  // true = MM Lite refused, Cloud API delivered it
  mm_lite_error?: string;      // what MM Lite said before we fell back
}

// One low-level Graph POST. Returns the HTTP status alongside the parsed body
// because the MM Lite fallback decision needs to distinguish "Meta structurally
// rejected the request" (safe to retry elsewhere) from "we never got an answer"
// (NOT safe — the message may already be on its way to the customer).
async function postToGraph(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; json: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

function toSendResult(r: { status: number; ok: boolean; json: any }): SendResult {
  if (!r.ok) {
    const e = r.json?.error ?? {};
    return {
      ok: false,
      message_id: null,
      raw: r.json,
      error: e?.message ?? `HTTP ${r.status}`,
      error_code: typeof e?.code === "number" ? e.code : undefined,
      error_detail: e?.error_data?.details ?? e?.error_user_msg ?? undefined,
    };
  }
  // Both /messages and /marketing_messages return the wamid in the same place:
  // messages[0].id. That is what wa_messages.wa_message_id stores and what the
  // delivery-status webhook keys on, so the ledger is path-agnostic.
  const id = r.json?.messages?.[0]?.id ?? null;
  return { ok: true, message_id: id, raw: r.json };
}

async function postMessage(body: Record<string, unknown>): Promise<SendResult> {
  return toSendResult(await postToGraph(`${GRAPH}/${phoneId()}/messages`, body));
}

// Brand copy rule: PROMUNCH never sends an em/en dash to a customer (it reads as
// AI-written). This is the deterministic safety net — applied to EVERY free-text
// WhatsApp message regardless of which function composed it. A spaced dash becomes
// a comma (", "), or just a space after existing sentence punctuation; a tight
// dash (word—word) becomes a hyphen. Then doubled punctuation/space is tidied.
export function stripEmDashes(text: string): string {
  return text
    .replace(/([.!?,;:])\s+[—–]\s+/g, "$1 ")  // after sentence punctuation -> just a space
    .replace(/\s+[—–]\s+/g, ", ")              // spaced dash -> comma
    .replace(/[—–]/g, "-")                      // any remaining tight dash -> hyphen
    .replace(/ {2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.!?,])/g, "$1");
}

export function sendText(to: string, text: string, previewUrl = false): Promise<SendResult> {
  return postMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: stripEmDashes(text), preview_url: previewUrl },
  });
}

export interface TemplateComponent {
  type: "header" | "body" | "button" | "footer";
  sub_type?: "quick_reply" | "url";
  index?: string;
  parameters?: Array<
    | { type: "text"; text: string }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: "date_time"; date_time: { fallback_value: string } }
    | { type: "image"; image: { link: string } }
    | { type: "document"; document: { link: string; filename?: string } }
    | { type: "video"; video: { link: string } }
    | { type: "payload"; payload: string }
  >;
}

// ---- Marketing Messages (MM Lite) API -----------------------------------
// Meta's separate send path for MARKETING-category templates. Same approved
// templates, same body schema, same wamid, same status webhooks — different
// endpoint, and Meta applies send-time delivery optimization on its side.
// Meta has signalled Cloud API marketing sends are being phased out in favour
// of it, and 84% of our marketing sends currently die on #131049.
//
// Docs (verified Aug 2026):
//   https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/marketing-messages-lite-api
//   https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started
//
// Endpoint:  POST {GRAPH}/{PHONE_NUMBER_ID}/marketing_messages
// Body:      identical to /messages for a template send. Two MM-Lite-only
//            optional fields exist (product_policy, message_activity_sharing);
//            we omit both unless explicitly configured, so the default payload
//            is byte-identical to what Cloud API already accepts.
//
// ROLLOUT SAFETY: this whole path is inert until WA_MM_LITE_ENABLED is set.
// With the secret unset, sendTemplate() does exactly what it did before —
// one postMessage() to /messages — and every MM Lite field stays undefined.

function mmLiteEnabled(): boolean {
  const v = (Deno.env.get("WA_MM_LITE_ENABLED") ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

// MM Lite is newer than our default v21.0 pin. Meta's docs use a placeholder
// <API_VERSION> rather than naming a floor, so this is separately overridable:
// if MM Lite rejects v21.0, set WA_MM_LITE_GRAPH_VERSION=v24.0 without touching
// the version every other Cloud API call uses.
function mmLiteGraph(): string {
  const v = Deno.env.get("WA_MM_LITE_GRAPH_VERSION");
  return v ? `https://graph.facebook.com/${v}` : GRAPH;
}

async function postMarketingMessage(body: Record<string, unknown>): Promise<{
  result: SendResult;
  status: number;
}> {
  // Optional MM-Lite-only fields. Both are omitted unless explicitly set, so a
  // wrong guess about their semantics can never break a live send by default.
  //   product_policy: "CLOUD_API_FALLBACK" | "STRICT" — asks Meta to fall back
  //     to Cloud API delivery itself. Ours is the outer, observable fallback.
  //   message_activity_sharing: boolean — opts into Meta's optimization signals.
  const policy = Deno.env.get("WA_MM_LITE_PRODUCT_POLICY");
  const sharing = (Deno.env.get("WA_MM_LITE_ACTIVITY_SHARING") ?? "").trim().toLowerCase();
  const payload: Record<string, unknown> = {
    recipient_type: "individual", // MM Lite's reference lists this as required
    ...body,
  };
  if (policy) payload.product_policy = policy;
  if (sharing === "true" || sharing === "1") payload.message_activity_sharing = true;

  const r = await postToGraph(`${mmLiteGraph()}/${phoneId()}/marketing_messages`, payload);
  return { result: toSendResult(r), status: r.status };
}

// Meta error codes that mean "MM Lite structurally refused this request and no
// message was created" — i.e. it is provably safe to send the same template via
// Cloud API without risking a duplicate (§0: never message a customer twice).
//
// Deliberately NOT in this list: #131049 / #131050 (per-user marketing cap),
// #132xxx (template param mismatch), rate limits, and any 5xx or thrown fetch.
// Those either fail identically on Cloud API or leave the outcome ambiguous, and
// an ambiguous outcome must never trigger a second send.
const MM_LITE_FALLBACK_CODES = new Set<number>([
  10,       // permission not granted / removed
  200,      // permissions error
  131055,   // MM Lite: only marketing templates supported
  134100,   // MM Lite: non-marketing template type unsupported
  134101,   // MM Lite: template still syncing (retry later) — Cloud API can send it now
  134102,   // MM Lite: template unavailable, or this user is ineligible for MM Lite
  1752041,  // MM Lite: onboarding request already submitted / not onboarded
]);

// Graph's generic "this node does not expose that edge" shape, which is exactly
// what an un-onboarded WABA gets when it POSTs to /marketing_messages:
//   code 100 — "Unsupported post request. Object with ID '<id>' does not exist,
//   cannot be loaded due to missing permissions, or does not support this
//   operation." Code 100 alone is too broad (it is also "invalid parameter" and
//   MM Lite's "message must be a template message"), so we require the message
//   text to name the endpoint/permission problem.
function isEndpointUnavailable(res: SendResult, status: number): boolean {
  if (status === 404) return true;
  const m = (res.error ?? "").toLowerCase();
  if (res.error_code === 100 || status === 400) {
    return m.includes("does not support this operation") ||
      m.includes("missing permissions") ||
      m.includes("unsupported post request") ||
      m.includes("does not exist");
  }
  return false;
}

function shouldFallBackToCloudApi(res: SendResult, status: number): boolean {
  if (res.ok) return false;
  // 5xx / gateway errors are ambiguous: Meta may have accepted and queued the
  // message before failing to answer us. Never re-send into that uncertainty.
  if (status >= 500) return false;
  if (status === 401 || status === 403) return true;
  if (res.error_code !== undefined && MM_LITE_FALLBACK_CODES.has(res.error_code)) return true;
  return isEndpointUnavailable(res, status);
}

// ---- Template category lookup (marketing vs utility) ---------------------
// A template is a marketing send when wa_templates.category === 'marketing'.
// The lookup and its cache now live in _shared/template-category.ts, shared with
// the marketing frequency governor, so there is ONE cache and one place that can
// be wrong about a category.
//
// MM Lite's safety direction is passed in explicitly and is the OPPOSITE of the
// governor's, deliberately:
//
//   fallback: false  → an unresolvable category means "not marketing", so the
//                      send stays on the Cloud API path it has always used.
//                      Routing a message onto a newer endpoint on a GUESS is the
//                      dangerous direction; staying put is free.
//
// Note the omitted `marketingAllowlist`: even a template we hardcode as
// marketing elsewhere will NOT be routed to MM Lite unless the live
// wa_templates row says so. Only authoritative data may move a send off the
// proven path. (The governor, whose wrong guess merely throttles, does pass its
// allowlists.)
async function isMarketingCategory(name: string, language: string): Promise<boolean> {
  return await classifyTemplate({ name, language, fallback: false });
}

export async function sendTemplate(
  to: string,
  name: string,
  language: string,
  components: TemplateComponent[] = [],
): Promise<SendResult> {
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      components,
    },
  };

  // Flag off (the default) → the exact call this function has always made.
  if (!mmLiteEnabled()) return postMessage(body);

  // MM Lite only accepts MARKETING-category templates; utility/authentication
  // sends (order confirmations, shipping updates) stay on Cloud API forever.
  if (!(await isMarketingCategory(name, language))) return postMessage(body);

  const { result: lite, status } = await postMarketingMessage(body);
  if (lite.ok) return { ...lite, send_path: "mm_lite" };

  // Not an enablement/permission-class refusal → this is a real send failure.
  // Report it as-is; retrying on Cloud API here could double-deliver.
  if (!shouldFallBackToCloudApi(lite, status)) return { ...lite, send_path: "mm_lite" };

  // MM Lite is not enabled / not permitted / refused this template outright and
  // provably created no message. Deliver via Cloud API so a misconfigured MM
  // Lite rollout can never mean zero marketing messages go out.
  console.warn(`mm-lite: falling back to Cloud API for "${name}" (#${lite.error_code ?? status}): ${lite.error}`);
  const cloud = await postMessage(body);
  return {
    ...cloud,
    send_path: "cloud_api",
    mm_lite_fallback: true,
    mm_lite_error: `#${lite.error_code ?? status} ${lite.error ?? "unknown"}`,
  };
}

export function sendImage(to: string, link: string, caption?: string): Promise<SendResult> {
  return postMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { link, caption },
  });
}

// ---- Interactive & commerce messages ------------------------------------
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages#interactive-object
//       https://developers.facebook.com/docs/whatsapp/cloud-api/guides/sell-products-with-your-messages

// Generic interactive send — caller passes the full `interactive` object.
// Covers list / reply-button / product / product_list / cta_url shapes.
export function sendInteractive(to: string, interactive: Record<string, unknown>): Promise<SendResult> {
  return postMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  });
}

// A tappable URL button (used to deliver the Shopify checkout link). The URL
// shows as a real button rather than raw text, and survives the 24h window as a
// normal session message.
export function buildCtaUrl(bodyText: string, displayText: string, url: string, footer?: string): Record<string, unknown> {
  const i: Record<string, unknown> = {
    type: "cta_url",
    body: { text: bodyText },
    action: { name: "cta_url", parameters: { display_text: displayText, url } },
  };
  if (footer) i.footer = { text: footer };
  return i;
}

// A single product card from the Meta catalog.
export function buildSingleProduct(catalogId: string, retailerId: string, bodyText?: string, footer?: string): Record<string, unknown> {
  const i: Record<string, unknown> = {
    type: "product",
    action: { catalog_id: catalogId, product_retailer_id: retailerId },
  };
  if (bodyText) i.body = { text: bodyText };
  if (footer) i.footer = { text: footer };
  return i;
}

export interface CatalogSection {
  title: string; // <= 24 chars per Meta
  product_items: Array<{ product_retailer_id: string }>;
}

// A multi-product list (the "browse the menu" card). Meta limits: up to 30
// products total across up to 10 sections; a header is required.
export function buildProductList(
  catalogId: string,
  headerText: string,
  bodyText: string,
  sections: CatalogSection[],
  footer?: string,
): Record<string, unknown> {
  const i: Record<string, unknown> = {
    type: "product_list",
    header: { type: "text", text: headerText },
    body: { text: bodyText },
    action: { catalog_id: catalogId, sections },
  };
  if (footer) i.footer = { text: footer };
  return i;
}

export function markRead(messageId: string): Promise<SendResult> {
  return postMessage({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  });
}

// Fetch a media URL by id (the URL is short-lived and auth-gated).
export async function fetchMedia(mediaId: string): Promise<{ url: string; mime: string } | null> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!meta.ok) return null;
  const j = await meta.json();
  return j?.url ? { url: j.url, mime: j.mime_type ?? "application/octet-stream" } : null;
}

// Download the actual media bytes for a media id (metadata hop → binary hop).
// Used to persist inbound photos / voice notes / video / docs to our storage.
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!meta.ok) return null;
  const j = await meta.json();
  if (!j?.url) return null;
  const bin = await fetch(j.url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!bin.ok) return null;
  return {
    bytes: new Uint8Array(await bin.arrayBuffer()),
    mime: j.mime_type ?? "application/octet-stream",
  };
}

// ---- Resumable upload (template media handles) --------------------------
// Image / video / document template HEADERS need a one-time "header handle"
// from the Resumable Upload API at CREATE time — a public URL is only accepted
// at SEND time, not when registering the template. Flow: open an upload session
// against the Meta App ID, POST the bytes, read back the handle `h`.
// Docs: https://developers.facebook.com/docs/graph-api/guides/upload

async function discoverAppId(): Promise<string | null> {
  const t = token();
  const res = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(t)}`,
  );
  const json = await res.json().catch(() => ({}));
  const id = json?.data?.app_id;
  return id ? String(id) : null;
}

export async function uploadResumable(bytes: Uint8Array, mime: string): Promise<string> {
  const appId = Deno.env.get("WHATSAPP_APP_ID") ?? (await discoverAppId());
  if (!appId) throw new Error("Could not resolve Meta App ID (set WHATSAPP_APP_ID)");
  const t = token();

  // 1) open a session
  const start = await fetch(
    `${GRAPH}/${appId}/uploads?file_length=${bytes.length}` +
      `&file_type=${encodeURIComponent(mime)}&access_token=${encodeURIComponent(t)}`,
    { method: "POST" },
  );
  const sj = await start.json().catch(() => ({}));
  if (!start.ok || !sj?.id) {
    throw new Error(`upload session failed: ${sj?.error?.message ?? start.status}`);
  }

  // 2) POST the bytes (OAuth scheme + file_offset header are required here)
  const up = await fetch(`${GRAPH}/${sj.id}`, {
    method: "POST",
    headers: { "Authorization": `OAuth ${t}`, "file_offset": "0" },
    // Type-only cast: Uint8Array<ArrayBufferLike> vs BodyInit lib mismatch.
    body: bytes as unknown as BodyInit,
  });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || !uj?.h) {
    throw new Error(`upload failed: ${uj?.error?.message ?? up.status}`);
  }
  return String(uj.h);
}

// Fetch the bytes of a publicly-hosted media URL (e.g. a Supabase wa-media
// public URL) so they can be pushed through uploadResumable().
export async function fetchMediaBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not fetch media ${url}: HTTP ${r.status}`);
  const mime = r.headers.get("content-type") ?? "image/jpeg";
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime };
}

// HMAC-SHA256 verification of X-Hub-Signature-256.
export async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
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
  // constant-time compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
