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

export function sendText(to: string, text: string, previewUrl = false): Promise<SendResult> {
  return postMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text, preview_url: previewUrl },
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
