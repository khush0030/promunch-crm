// backfill-brand
// ---------------------------------------------------------------------------
// One-shot historical importer. Scans the mailbox's SENT mail, pairs each
// customer email with the human-written reply that was actually sent, and
// stores the pair in brand_knowledge as an `approved_reply` example. This
// primes the agent's "brain" with the real PROMUNCH voice from day one.
//
// Gated by ?token=<SETUP_TOKEN> (same gate as oauth-callback). Safe to run
// multiple times — it dedupes by gmail thread id against existing rows.
//
//   POST/GET /backfill-brand?token=<SETUP_TOKEN>&max=300

import { getAccessToken } from "../_shared/gmail.ts";
import { db } from "../_shared/supabase.ts";

const MAILBOX = (Deno.env.get("MAILBOX_EMAIL") ?? "hello@promunch.in").toLowerCase();
const SETUP_TOKEN = Deno.env.get("SETUP_TOKEN") ?? "";

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}
interface GmailMsg {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload: GmailPart;
}

async function gapi<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Gmail ${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  try {
    return new TextDecoder("utf-8").decode(
      Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0)),
    );
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

function bodyText(payload: GmailPart): string {
  let plain = "";
  let html = "";
  const walk = (p: GmailPart) => {
    if (p.body?.data) {
      const d = b64urlDecode(p.body.data);
      if (p.mimeType === "text/plain") plain += d;
      else if (p.mimeType === "text/html") html += d;
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return (plain || stripHtml(html)).trim();
}

// Trim quoted history / forwards / signatures so the example is just the
// actual human-written reply. Cuts at the earliest boundary marker.
function cleanReply(text: string): string {
  const t = text.replace(/\r\n/g, "\n");
  const cutPatterns = [
    /\bOn .{0,250}?\bwrote:/s, // "On <date> <name>\nwrote:" (multiline)
    /^\s*wrote:\s*$/m, // bare wrapped "wrote:"
    /^\s*-{2,}\s*Forwarded message\s*-{2,}/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}/im,
    /^\s*_{5,}\s*$/m, // Outlook divider
    /^\s*From:\s.+$/m, // quoted header block
    /^-- \s*$/m, // signature delimiter
    /^\s*Sent from my \w+/im,
  ];
  let cut = t.length;
  for (const re of cutPatterns) {
    const m = t.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  let body = t.slice(0, cut);
  body = body
    .split("\n")
    .filter((ln) => !/^\s*>/.test(ln))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body;
}

// Reject low-value or non-brand-voice examples.
function isUsableExample(
  inbound: string,
  reply: string,
  custFrom: string,
  subject: string,
): boolean {
  if (reply.length < 40 || inbound.length < 30) return false;
  // terse acks add no voice signal
  if (/^(noted|ok|okay|thanks|thank you|done|sure|great)[.! ]*$/i.test(reply)) {
    return false;
  }
  const from = custFrom.toLowerCase();
  if (from.includes("@promunch.in")) return false; // internal/self
  if (/no-?reply|do-?not-?reply|mailer-daemon|notifications?@/i.test(from)) {
    return false;
  }
  if (/^\s*(fwd:|fw:)/i.test(subject)) return false; // forwarded chains
  if (/^-{3,}\s*Forwarded/i.test(reply)) return false;
  // Drop recruitment/HR threads — mailbox gets heavy job-application volume
  // and that voice is wrong for customer support drafting.
  const hay = (subject + " " + inbound).toLowerCase();
  if (
    /\b(intern(ship)?|application for|founder'?s office|resume|\bcv\b|hiring|job|candidate|availability for an interview|cover letter|fresher|placement)\b/
      .test(hay)
  ) {
    return false;
  }
  if (/availability for an interview|share your (resume|cv)/i.test(reply)) {
    return false;
  }
  return true;
}

function header(p: GmailPart, name: string): string {
  return (
    p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== SETUP_TOKEN || !SETUP_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }
  // Edge functions have a tight CPU/mem budget — process a small slice per
  // call. Use &start= to page through history across multiple invocations.
  const max = Math.min(parseInt(url.searchParams.get("max") ?? "25"), 40);
  const start = Math.max(parseInt(url.searchParams.get("start") ?? "0"), 0);

  const supabase = db();
  const token = await getAccessToken();

  // Page through SENT messages
  const sentIds: string[] = [];
  let pageToken = "";
  while (sentIds.length < start + max) {
    const q = new URLSearchParams({
      q: "in:sent -in:chats",
      maxResults: "100",
    });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await gapi<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `/users/me/messages?${q}`,
      token,
    );
    for (const m of page.messages ?? []) sentIds.push(m.id);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  // Existing backfilled threads (dedupe)
  const { data: existing } = await supabase
    .from("brand_knowledge")
    .select("tags")
    .eq("kind", "approved_reply")
    .contains("tags", ["backfill"]);
  const seenThreads = new Set<string>();
  for (const r of (existing ?? []) as Array<{ tags: string[] | null }>) {
    for (const t of r.tags ?? []) {
      if (t !== "backfill") seenThreads.add(t);
    }
  }

  let scanned = 0;
  let paired = 0;
  let inserted = 0;
  const skip = {
    dupThread: 0,
    threadErr: 0,
    singleMsg: 0,
    noReply: 0,
    noCustomer: 0,
    tooShort: 0,
  };
  let sampleFrom = "";
  const batch: Array<Record<string, unknown>> = [];
  const processedThreads = new Set<string>();

  const slice = sentIds.slice(start, start + max);
  for (const id of slice) {
    scanned++;
    let head: { threadId: string };
    try {
      head = await gapi<{ threadId: string }>(`/users/me/messages/${id}?format=minimal`, token);
    } catch {
      continue;
    }
    const threadId = head.threadId;
    if (processedThreads.has(threadId)) continue;
    processedThreads.add(threadId);
    if (seenThreads.has(threadId)) {
      skip.dupThread++;
      continue;
    }

    let thread: { messages?: GmailMsg[] };
    try {
      thread = await gapi<{ messages?: GmailMsg[] }>(
        `/users/me/threads/${threadId}?format=full`,
        token,
      );
    } catch {
      skip.threadErr++;
      continue;
    }
    const msgs = (thread.messages ?? []).sort(
      (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0),
    );
    if (msgs.length < 2) {
      skip.singleMsg++;
      continue;
    }
    if (msgs.length > 12) {
      skip.singleMsg++; // long chain — slow + noisy, skip
      continue;
    }

    // Our reply = last message sent by the mailbox
    let replyIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const from = header(msgs[i].payload, "From").toLowerCase();
      if (from.includes(MAILBOX) || (msgs[i].labelIds ?? []).includes("SENT")) {
        replyIdx = i;
        break;
      }
    }
    if (replyIdx < 0) {
      skip.noReply++;
      if (!sampleFrom) sampleFrom = header(msgs[msgs.length - 1].payload, "From");
      continue;
    }

    // Customer message = last inbound before our reply
    let custIdx = -1;
    for (let i = replyIdx - 1; i >= 0; i--) {
      const from = header(msgs[i].payload, "From").toLowerCase();
      if (!from.includes(MAILBOX)) {
        custIdx = i;
        break;
      }
    }
    if (custIdx < 0) {
      skip.noCustomer++;
      continue;
    }

    const inbound = bodyText(msgs[custIdx].payload).slice(0, 1500);
    const reply = cleanReply(bodyText(msgs[replyIdx].payload)).slice(0, 1800);
    const custFrom = header(msgs[custIdx].payload, "From");
    const subject = header(msgs[custIdx].payload, "Subject") ||
      header(msgs[replyIdx].payload, "Subject");
    if (!isUsableExample(inbound, reply, custFrom, subject)) {
      skip.tooShort++;
      continue;
    }

    paired++;
    batch.push({
      kind: "approved_reply",
      inbound_subject: subject || null,
      inbound_excerpt: inbound,
      final_reply: reply,
      source_thread_id: null, // email_threads row doesn't exist for historical mail
      tags: ["backfill", threadId],
    });

    if (batch.length >= 100) {
      const { error } = await supabase.from("brand_knowledge").insert(batch);
      if (!error) inserted += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length) {
    const { error } = await supabase.from("brand_knowledge").insert(batch);
    if (!error) inserted += batch.length;
  }

  const nextStart = start + slice.length;
  const moreLikely = slice.length === max;
  return new Response(
    JSON.stringify(
      { ok: true, start, scanned, paired, inserted, nextStart, moreLikely, skip, sampleFrom },
      null,
      2,
    ),
    { headers: { "content-type": "application/json" } },
  );
});
