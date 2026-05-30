// Gmail API helper — handles OAuth refresh, fetching messages, sending replies.
//
// We use the raw Gmail REST API (no SDK) since we run on Deno and want
// minimal dependencies. The refresh token is loaded from the oauth_tokens
// table at request time.

import { db } from "./supabase.ts";
import { logConnector } from "./connector-log.ts";
import { ParsedEmail } from "./types.ts";

const MAILBOX = Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SETUP_TOKEN = Deno.env.get("SETUP_TOKEN") ?? "";
// Surfaced in the Slack alert + dashboard so operators have a one-click re-auth.
const REAUTH_URL = SUPABASE_URL && SETUP_TOKEN
  ? `${SUPABASE_URL}/functions/v1/oauth-callback?action=start&token=${SETUP_TOKEN}`
  : "";

// ---------------------------------------------------------------------------
// OAuth: exchange refresh token for a short-lived access token.
// We cache in-memory for the lifetime of the function instance (Deno isolates
// are recycled frequently, so this is naturally bounded).
// ---------------------------------------------------------------------------
let _accessToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (_accessToken && _accessToken.expiresAt > Date.now() + 30_000) {
    return _accessToken.token;
  }

  const { data, error } = await db()
    .from("oauth_tokens")
    .select("refresh_token, updated_at")
    .eq("email", MAILBOX)
    .single();

  if (error || !data) {
    await logConnector({
      connector: "gmail_pipeline",
      level: "error",
      event: "auth_missing",
      message: `No refresh token stored for ${MAILBOX}. Re-auth required.`,
      detail: { reauth_url: REAUTH_URL },
    });
    throw new Error(`No refresh token stored for ${MAILBOX}. Run /oauth-callback first.`);
  }

  // Proactive warning: Google's OAuth consent screen in "Testing" mode issues
  // refresh tokens that expire after 7 days. Surface this before it dies so
  // the operator can re-auth in advance instead of after a silent outage.
  const tokenAgeDays = (Date.now() - new Date(data.updated_at as string).getTime()) / 86_400_000;
  if (tokenAgeDays > 5) {
    await logConnector({
      connector: "gmail_pipeline",
      level: "warn",
      event: "auth_ageing",
      message: `Gmail refresh token is ${tokenAgeDays.toFixed(1)} days old — re-auth in the next 48h to avoid an outage. ${REAUTH_URL ? "Re-auth: " + REAUTH_URL : ""}`,
      detail: { token_age_days: tokenAgeDays, reauth_url: REAUTH_URL },
      throttleMinutes: 12 * 60,
    });
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: data.refresh_token,
    grant_type: "refresh_token",
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    const expired = /invalid_grant|Token has been expired or revoked/i.test(text);
    if (expired) {
      // Distinct event so the alert message tells the operator what to do
      // instead of dumping a raw OAuth 400 in Slack.
      await logConnector({
        connector: "gmail_pipeline",
        level: "error",
        event: "auth_expired",
        message: `Gmail refresh token expired or revoked. Re-auth: ${REAUTH_URL || "/oauth-callback?action=start&token=..."}`,
        detail: { reauth_url: REAUTH_URL, http_status: resp.status, response: text.slice(0, 500) },
      });
    }
    throw new Error(`OAuth token refresh failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  _accessToken = {
    token: json.access_token as string,
    expiresAt: Date.now() + (json.expires_in as number) * 1000,
  };
  return _accessToken.token;
}

// ---------------------------------------------------------------------------
// Low-level fetch wrapper
// ---------------------------------------------------------------------------
async function gmail<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`Gmail API ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// History API — used by gmail-webhook to list new messages since last history_id
// ---------------------------------------------------------------------------
export interface HistoryEntry {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
}

export async function listHistory(startHistoryId: string): Promise<{
  history: HistoryEntry[];
  historyId: string;
}> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
    labelId: "INBOX",
  });
  const resp = await gmail<{ history?: HistoryEntry[]; historyId: string }>(
    `/users/me/history?${params}`,
  );
  return { history: resp.history ?? [], historyId: resp.historyId };
}

// ---------------------------------------------------------------------------
// Poll fallback — list unread inbox messages
// ---------------------------------------------------------------------------
// List recent inbox messages — independent of read state. The pipeline's
// idempotency check (email_threads.gmail_message_id) makes re-scanning safe,
// so we deliberately drop `is:unread` here. That way the poll still catches
// emails the user already opened in Gmail before Pub/Sub or our processor
// got to them.
export async function listUnreadInbox(maxResults = 20): Promise<Array<{ id: string; threadId: string }>> {
  const params = new URLSearchParams({
    q: "in:inbox -from:me newer_than:1d",
    maxResults: String(maxResults),
  });
  const resp = await gmail<{ messages?: Array<{ id: string; threadId: string }> }>(
    `/users/me/messages?${params}`,
  );
  return resp.messages ?? [];
}

// ---------------------------------------------------------------------------
// Fetch + parse a single message
// ---------------------------------------------------------------------------
export async function getMessage(messageId: string): Promise<ParsedEmail> {
  const msg = await gmail<GmailMessage>(`/users/me/messages/${messageId}?format=full`);
  return parseMessage(msg);
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  snippet?: string;
  payload: GmailMessagePart;
}

function parseMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload.headers ?? [];
  const h = (name: string) =>
    headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? null;

  const fromHeader = h("From") ?? "";
  const fromMatch = fromHeader.match(/^\s*(?:"?([^"<]*?)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?\s*$/);
  const from_name = fromMatch?.[1]?.trim() || null;
  const from_email = fromMatch?.[2]?.trim() || fromHeader.trim();

  // Walk MIME parts collecting text/plain and text/html
  let plain = "";
  let html = "";
  walk(msg.payload, (part) => {
    if (!part.body?.data) return;
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === "text/plain") plain += decoded;
    else if (part.mimeType === "text/html") html += decoded;
  });

  if (!plain && html) plain = stripHtml(html);

  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    history_id: msg.historyId ?? null,
    in_reply_to_header: h("Message-Id") ?? h("Message-ID") ?? "",
    from_email,
    from_name,
    to_email: h("To"),
    subject: h("Subject"),
    snippet: msg.snippet ?? null,
    body_plain: plain.trim(),
    body_html: html || null,
  };
}

function walk(part: GmailMessagePart, fn: (p: GmailMessagePart) => void) {
  fn(part);
  for (const p of part.parts ?? []) walk(p, fn);
}

function decodeBase64Url(s: string): string {
  // Gmail uses URL-safe base64 without padding
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  try {
    return new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Mark a message as read (after we've processed it)
// ---------------------------------------------------------------------------
export async function markRead(messageId: string): Promise<void> {
  await gmail(`/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

// ---------------------------------------------------------------------------
// Send a reply in the same thread
// ---------------------------------------------------------------------------
export async function sendReply(opts: {
  threadId: string;
  to: string;
  subject: string;
  inReplyTo: string;        // the original Message-Id header value
  bodyPlain: string;
}): Promise<{ id: string; threadId: string }> {
  // Build an RFC 2822 message
  const subject = opts.subject.toLowerCase().startsWith("re:")
    ? opts.subject
    : `Re: ${opts.subject}`;
  const refs = opts.inReplyTo;

  const message =
    `To: ${opts.to}\r\n` +
    `From: ${MAILBOX}\r\n` +
    `Subject: ${subject}\r\n` +
    (refs ? `In-Reply-To: ${refs}\r\n` : "") +
    (refs ? `References: ${refs}\r\n` : "") +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: 8bit\r\n` +
    `\r\n` +
    opts.bodyPlain;

  const raw = encodeBase64Url(message);

  return await gmail<{ id: string; threadId: string }>(
    "/users/me/messages/send",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw, threadId: opts.threadId }),
    },
  );
}

function encodeBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Watch / Stop — Pub/Sub subscription management for push notifications
// ---------------------------------------------------------------------------
export async function startWatch(topicName: string): Promise<{
  historyId: string;
  expiration: string;
}> {
  return await gmail<{ historyId: string; expiration: string }>(
    "/users/me/watch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topicName,                  // e.g. "projects/promunch-prod/topics/gmail-hello"
        labelIds: ["INBOX"],
        labelFilterAction: "include",
      }),
    },
  );
}

export async function stopWatch(): Promise<void> {
  await gmail("/users/me/stop", { method: "POST" });
}
