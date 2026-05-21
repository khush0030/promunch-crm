// Slack Web API helpers + signature verification + block builder.

const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET")!;
const SLACK_CHANNEL_ID = Deno.env.get("SLACK_CHANNEL_ID")!;

// ---------------------------------------------------------------------------
// Web API wrapper
// ---------------------------------------------------------------------------
async function slack<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(`Slack ${method} failed: ${JSON.stringify(json)}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Post the initial email + draft to the channel
// ---------------------------------------------------------------------------
export interface Classification {
  lead_category: string;
  urgency: string;
  score: number;
  rationale: string;
}

export interface PostEmailOpts {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyPreview: string;        // truncated plain body
  snippet?: string | null;    // Gmail snippet — fallback when body is empty
  draftBody: string;
  emailThreadId: string;      // our DB pk — embedded in button values for routing
  draftRevisionId: string;
  classification?: Classification | null;
}

export async function postEmailWithDraft(opts: PostEmailOpts): Promise<{
  ts: string;
  channel: string;
  permalink: string;
}> {
  const blocks = buildEmailBlocks(opts);
  const resp = await slack<{ ts?: string; channel?: string }>("chat.postMessage", {
    channel: SLACK_CHANNEL_ID,
    text: `New email from ${opts.fromName ?? opts.fromEmail}: ${opts.subject ?? "(no subject)"}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  const channel = resp.channel || SLACK_CHANNEL_ID;
  const ts = resp.ts;
  if (!ts) {
    throw new Error(`Slack postMessage returned no ts: ${JSON.stringify(resp)}`);
  }
  // Permalink is nice-to-have; never fail the whole pipeline over it.
  let permalink = "";
  try {
    const perma = await slack<{ permalink: string }>("chat.getPermalink", {
      channel,
      message_ts: ts,
    });
    permalink = perma.permalink;
  } catch (e) {
    console.warn("chat.getPermalink failed (non-fatal):", e instanceof Error ? e.message : e);
  }
  return { ts, channel, permalink };
}

// ---------------------------------------------------------------------------
// Post a compact card for emails that don't warrant a reply (newsletters,
// transactional, automated, marketing, spam). No buttons — just a record.
// ---------------------------------------------------------------------------
export async function postNoReplyCard(opts: {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyPreview: string;
  snippet?: string | null;
  classification: Classification;
}): Promise<{ ts: string; channel: string; permalink: string }> {
  const fromLine = opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail;
  const catEmoji = CATEGORY_EMOJI[opts.classification.lead_category] ?? ":speech_balloon:";
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${catEmoji} Auto-skipped — ${opts.classification.lead_category.replace(/_/g, " ")} · ${opts.classification.score}/10`.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From*\n${fromLine}` },
        { type: "mrkdwn", text: `*Subject*\n${opts.subject ?? "(no subject)"}` },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Email*\n${quoteLines(customerMessage(opts.bodyPreview, opts.snippet))}`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `_:robot_face: ${opts.classification.rationale}_` },
      ],
    },
  ];
  const resp = await slack<{ ts?: string; channel?: string }>("chat.postMessage", {
    channel: SLACK_CHANNEL_ID,
    text: `Auto-skipped: ${opts.subject ?? "(no subject)"}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  const channel = resp.channel || SLACK_CHANNEL_ID;
  const ts = resp.ts;
  if (!ts) throw new Error(`Slack postMessage returned no ts: ${JSON.stringify(resp)}`);
  let permalink = "";
  try {
    const perma = await slack<{ permalink: string }>("chat.getPermalink", { channel, message_ts: ts });
    permalink = perma.permalink;
  } catch (_) { /* non-fatal */ }
  return { ts, channel, permalink };
}

// ---------------------------------------------------------------------------
// Post a new draft revision as a thread reply
// ---------------------------------------------------------------------------
export async function postDraftRevision(opts: {
  channel: string;
  threadTs: string;
  revision: number;
  feedback: string | null;
  draftBody: string;
  emailThreadId: string;
  draftRevisionId: string;
}): Promise<{ ts: string }> {
  const blocks: unknown[] = [];
  if (opts.feedback) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `:writing_hand: Revised based on your feedback` }],
    });
  }
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Draft v${opts.revision}*\n${quoteLines((opts.draftBody ?? "").trim(), 2500)}`,
    },
  });
  blocks.push(actionsBlock(opts.emailThreadId, opts.draftRevisionId));

  const resp = await slack<{ ts: string }>("chat.postMessage", {
    channel: opts.channel,
    thread_ts: opts.threadTs,
    text: `Draft v${opts.revision}`,
    blocks,
  });
  return { ts: resp.ts };
}

// ---------------------------------------------------------------------------
// Post the customer email to Slack WITHOUT an AI draft.
//
// Used when Claude is unavailable (down / out of credits). Email delivery to
// Slack must never depend on drafting succeeding — the team still needs to
// see the email and can reply manually in Gmail. No action buttons here: once
// drafting recovers, the poll posts the draft (with buttons) as a thread reply.
// ---------------------------------------------------------------------------
export async function postEmailNoDraft(opts: {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyPreview: string;
  snippet?: string | null;
  classification?: Classification | null;
  reason?: string | null;
}): Promise<{ ts: string; channel: string; permalink: string }> {
  const fromLine = opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail;
  const cleanIn = customerMessage(opts.bodyPreview, opts.snippet);
  const cls = opts.classification ?? null;
  const reason = opts.reason || "the AI drafting service is currently unavailable";
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: ":envelope_with_arrow: New email — needs manual reply", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From*\n${fromLine}` },
        { type: "mrkdwn", text: `*Subject*\n${opts.subject ?? "(no subject)"}` },
      ],
    },
    ...(cls ? [classificationBlock(cls)] : []),
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: `*Customer message*\n${quoteLines(cleanIn)}` } },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `:warning: *AI draft unavailable* — ${reason}. Reply directly in Gmail. ` +
            `A drafted reply will appear in this thread automatically once AI drafting recovers.`,
        },
      ],
    },
  ];
  const resp = await slack<{ ts?: string; channel?: string }>("chat.postMessage", {
    channel: SLACK_CHANNEL_ID,
    text: `New email (no draft) from ${opts.fromName ?? opts.fromEmail}: ${opts.subject ?? "(no subject)"}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  const channel = resp.channel || SLACK_CHANNEL_ID;
  const ts = resp.ts;
  if (!ts) throw new Error(`Slack postMessage returned no ts: ${JSON.stringify(resp)}`);
  let permalink = "";
  try {
    const perma = await slack<{ permalink: string }>("chat.getPermalink", { channel, message_ts: ts });
    permalink = perma.permalink;
  } catch (_) { /* non-fatal */ }
  return { ts, channel, permalink };
}

// ---------------------------------------------------------------------------
// Thread reply for a follow-up customer message when drafting is unavailable.
// ---------------------------------------------------------------------------
export async function postNoDraftReply(opts: {
  channel: string;
  threadTs: string;
  customerMessage: string;
  snippet?: string | null;
  reason?: string | null;
}): Promise<{ ts: string }> {
  const cleanIn = customerMessage(opts.customerMessage, opts.snippet);
  const reason = opts.reason || "the AI drafting service is currently unavailable";
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*New customer reply*\n${quoteLines(cleanIn)}` } },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:warning: *AI draft unavailable* — ${reason}. A drafted reply will appear here once it recovers.`,
        },
      ],
    },
  ];
  const resp = await slack<{ ts: string }>("chat.postMessage", {
    channel: opts.channel,
    thread_ts: opts.threadTs,
    text: "New customer reply (no draft)",
    blocks,
  });
  return { ts: resp.ts };
}

// ---------------------------------------------------------------------------
// Rebuild the parent email card AFTER sending. Same content as the original
// post — From, Subject, classification, customer message, the reply — but with
// the action buttons removed and a "Sent" banner on top. This keeps the
// original email visible in the channel instead of nuking it to one line.
// ---------------------------------------------------------------------------
export function buildSentBlocks(opts: {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyPreview: string;
  snippet?: string | null;
  draftBody: string;
  classification?: Classification | null;
  approvedBySlackUser?: string | null;
}): unknown[] {
  const fromLine = opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail;
  const cleanIn = customerMessage(opts.bodyPreview, opts.snippet);
  const cleanDraft = (opts.draftBody ?? "").trim();
  const cls = opts.classification ?? null;
  const approver = opts.approvedBySlackUser ? ` by <@${opts.approvedBySlackUser}>` : "";
  return [
    { type: "header", text: { type: "plain_text", text: ":white_check_mark: Email sent", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From*\n${fromLine}` },
        { type: "mrkdwn", text: `*Subject*\n${opts.subject ?? "(no subject)"}` },
      ],
    },
    ...(cls ? [classificationBlock(cls)] : []),
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Customer message*\n${quoteLines(cleanIn)}` },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*:outbox_tray: Reply sent*\n${quoteLines(cleanDraft, 2500)}` },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `:white_check_mark: *Sent*${approver} — reply delivered to ${opts.fromEmail}` },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Update a message (used after Approve to mark "Sent")
// ---------------------------------------------------------------------------
export async function updateMessage(opts: {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}): Promise<void> {
  await slack("chat.update", {
    channel: opts.channel,
    ts: opts.ts,
    text: opts.text,
    blocks: opts.blocks,
  });
}

// ---------------------------------------------------------------------------
// Reply in a thread (used for status/error messages)
// ---------------------------------------------------------------------------
export async function replyInThread(channel: string, threadTs: string, text: string) {
  await slack("chat.postMessage", { channel, thread_ts: threadTs, text });
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------
// Strip email signatures, quoted history, and reply chains so the Slack
// preview shows only the actual customer message / actual draft body.
function cleanForDisplay(text: string): string {
  // First strip marketing-HTML noise that survived stripHtml() in gmail.ts:
  // zero-width chars, leftover HTML entities, CSS/MSO comments, repeated junk.
  let t = (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/&zwnj;|&#847;|&#8203;|&#xfeff;|&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, "") // any other stray named entity
    .replace(/[​-‏‪-‮⁠﻿]/g, "") // zero-width / bidi
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const cuts = [
    /\bOn .{0,250}?\bwrote:/s,
    /^\s*wrote:\s*$/m,
    /^\s*-{2,}\s*Forwarded message\s*-{2,}/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+$/m,
    /^-- ?\s*$/m, // signature delimiter (with or without trailing space)
    /^\s*Sent from my \w+/im,
  ];
  let cut = t.length;
  for (const re of cuts) {
    const m = t.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return t
    .slice(0, cut)
    .split("\n")
    .filter((ln) => !/^\s*>/.test(ln))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Lightly clean raw text — decode HTML entities (named + numeric) and collapse
// whitespace — WITHOUT stripping quoted history. Used as a fallback when
// cleanForDisplay() removes too much (common with HTML/marketing emails whose
// plain-text part is mostly layout whitespace).
function lightClean(text: string): string {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/&nbsp;|&zwnj;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&[a-z]+;/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Always produce a readable customer message for the Slack card — never empty.
// Preference order:
//   1. the de-quoted body (cleanForDisplay) — best when it has real content
//   2. the lightly cleaned full body — when 1 stripped too much
//   3. Gmail's own snippet — guaranteed-populated short summary
function customerMessage(bodyPlain: string, snippet?: string | null, max = 1500): string {
  const meaningful = (s: string) => s.replace(/\s+/g, "").length >= 30;

  const deQuoted = cleanForDisplay(bodyPlain);
  if (meaningful(deQuoted)) return truncate(deQuoted, max);

  const full = lightClean(bodyPlain);
  if (meaningful(full)) return truncate(full, max);

  const snip = lightClean(snippet ?? "");
  if (snip) return truncate(snip, max);

  return deQuoted || full || "_(No message preview — open the email in Gmail.)_";
}

// Render multi-line text as a Slack blockquote (one ">" per line).
function quoteLines(text: string, max = 1500): string {
  const t = truncate(text.trim(), max);
  return t
    .split("\n")
    .map((ln) => (ln.length ? `> ${ln}` : ">"))
    .join("\n");
}

const CATEGORY_EMOJI: Record<string, string> = {
  customer_support: ":handshake:",
  order_tracking: ":package:",
  complaint: ":warning:",
  partnership_inquiry: ":bulb:",
  wholesale: ":shopping_trolley:",
  job_application: ":briefcase:",
  spam: ":no_entry_sign:",
  general: ":speech_balloon:",
};
const URGENCY_EMOJI: Record<string, string> = {
  critical: ":rotating_light:",
  high: ":red_circle:",
  medium: ":large_yellow_circle:",
  low: ":large_blue_circle:",
};

function classificationBlock(c: Classification): unknown {
  const catLabel = (c.lead_category ?? "general").replace(/_/g, " ");
  const urgLabel = (c.urgency ?? "medium").toUpperCase();
  const catEmoji = CATEGORY_EMOJI[c.lead_category] ?? ":speech_balloon:";
  const urgEmoji = URGENCY_EMOJI[c.urgency] ?? ":large_yellow_circle:";
  return {
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Lead*\n${catEmoji} ${catLabel}`,
      },
      {
        type: "mrkdwn",
        text: `*Urgency*\n${urgEmoji} ${urgLabel}`,
      },
      {
        type: "mrkdwn",
        text: `*Score*\n*${c.score}/10*`,
      },
      {
        type: "mrkdwn",
        text: `*AI rationale*\n_${c.rationale || "—"}_`,
      },
    ],
  };
}

function buildEmailBlocks(opts: PostEmailOpts): unknown[] {
  const fromLine = opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail;
  const cleanIn = customerMessage(opts.bodyPreview, opts.snippet);
  const cleanDraft = (opts.draftBody ?? "").trim();
  const cls = opts.classification ?? null;
  const headerText = cls
    ? `${URGENCY_EMOJI[cls.urgency] ?? ":email:"} New email — ${(cls.lead_category ?? "general").replace(/_/g, " ")} · ${cls.score}/10`
    : ":email: New email";
  return [
    { type: "header", text: { type: "plain_text", text: headerText.slice(0, 150), emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*From*\n${fromLine}` },
        { type: "mrkdwn", text: `*Subject*\n${opts.subject ?? "(no subject)"}` },
      ],
    },
    ...(cls ? [classificationBlock(cls), { type: "divider" }] : []),
  ].concat(buildBodyAndDraftBlocks(opts.subject, cleanIn, cleanDraft, opts.emailThreadId, opts.draftRevisionId) as unknown[]);
}

function buildBodyAndDraftBlocks(
  _subject: string | null,
  cleanIn: string,
  cleanDraft: string,
  emailThreadId: string,
  draftRevisionId: string,
): unknown[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Customer message*\n${quoteLines(cleanIn)}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:sparkles: Drafted reply*\n${quoteLines(cleanDraft, 2500)}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Reply in this thread with feedback to revise, or click below to send as-is._",
        },
      ],
    },
    actionsBlock(emailThreadId, draftRevisionId),
  ];
}

function actionsBlock(emailThreadId: string, draftRevisionId: string): unknown {
  const value = JSON.stringify({ t: emailThreadId, r: draftRevisionId });
  return {
    type: "actions",
    block_id: "draft_actions",
    elements: [
      {
        type: "button",
        action_id: "approve_send",
        style: "primary",
        text: { type: "plain_text", text: ":white_check_mark: Approve & Send" },
        value,
        confirm: {
          title: { type: "plain_text", text: "Send this reply?" },
          text: { type: "mrkdwn", text: "Reply will be sent in the original Gmail thread." },
          confirm: { type: "plain_text", text: "Send" },
          deny: { type: "plain_text", text: "Cancel" },
        },
      },
      {
        type: "button",
        action_id: "regenerate",
        text: { type: "plain_text", text: ":arrows_counterclockwise: Regenerate" },
        value,
      },
      {
        type: "button",
        action_id: "skip",
        style: "danger",
        text: { type: "plain_text", text: ":wastebasket: Skip" },
        value,
      },
    ],
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function escapeForCode(s: string): string {
  // Slack code blocks can't contain a triple backtick. Replace with single ticks.
  return s.replace(/```/g, "ʼʼʼ");
}

// ---------------------------------------------------------------------------
// Signature verification (Slack request authenticity check)
// ---------------------------------------------------------------------------
export async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;

  // Reject if older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;

  const basestring = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring));
  const macHex = Array.from(new Uint8Array(macBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${macHex}`;
  return timingSafeEqual(expected, sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export const SLACK_DEFAULT_CHANNEL = SLACK_CHANNEL_ID;
