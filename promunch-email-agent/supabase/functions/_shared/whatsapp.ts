// Meta WhatsApp Cloud API client.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Required env:
//   WHATSAPP_PHONE_NUMBER_ID      — sender phone number id (digits)
//   WHATSAPP_ACCESS_TOKEN         — permanent system-user token
//   WHATSAPP_VERIFY_TOKEN         — webhook verify token (you choose)
//   WHATSAPP_APP_SECRET           — app secret, for X-Hub-Signature-256 check
//   WHATSAPP_GRAPH_VERSION        — optional, defaults to v21.0

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

export interface SendResult {
  message_id: string | null;
  raw: unknown;
  ok: boolean;
  error?: string;
  error_code?: number;   // Meta error.code — drives the failure-alert explainer
  error_detail?: string; // Meta error_data.details / error_user_msg, if present
}

async function postMessage(body: Record<string, unknown>): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/${phoneId()}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    return {
      ok: false,
      message_id: null,
      raw: json,
      error: e?.message ?? `HTTP ${res.status}`,
      error_code: typeof e?.code === "number" ? e.code : undefined,
      error_detail: e?.error_data?.details ?? e?.error_user_msg ?? undefined,
    };
  }
  const id = json?.messages?.[0]?.id ?? null;
  return { ok: true, message_id: id, raw: json };
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

export function sendTemplate(
  to: string,
  name: string,
  language: string,
  components: TemplateComponent[] = [],
): Promise<SendResult> {
  return postMessage({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: language },
      components,
    },
  });
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
    body: bytes,
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
