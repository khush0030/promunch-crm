// AI triage + reply agent for Instagram inbound DMs and comments.
//
// Triages every inbound message into collab | order | spam | unknown, then —
// gated by ig_settings — auto-replies routine messages from the Master KB,
// escalates real barter inquiries to a human (Slack + collab pipeline), and
// labels spam without replying. Mirrors wa-ai-reply (KB prompt-stuffed, robust
// JSON parse, atomic per-turn claim so a retry can never double-DM).
//
// Modes:
//   normal — reply to the user; classify + escalate as side effects
//   draft  — return the suggested reply + classification only (dashboard button)

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { businessDiscovery } from "../_shared/instagram.ts";
import { postSlack, slackChannelFor } from "../_shared/connector-log.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = Deno.env.get("IG_AI_MODEL") ?? "gpt-4o-mini";
const KB_CHAR_BUDGET = 12_000;

interface InvokeBody {
  thread_id: string;
  last_message?: string;
  inbound_id?: string;
  kind?: "dm" | "comment";
  comment_id?: string;
  draft?: boolean;
  job_id?: string | null;
}

function systemPrompt(scope: string, barterTerms: string | null): string {
  return (
    `You are the Instagram DM agent for PROMUNCH (an Indian healthy-snack brand under Vippy Industries Limited — protein munchies, edamame snacks; "Your Munchy Pal").\n\n` +
    `Instagram gets a lot of DMs and comments. Your job is to TRIAGE each one and reply where appropriate. Keep replies SHORT (1-3 sentences), warm, India-English, never corporate.\n\n` +
    `BRAND COPY RULES (strict): always write the brand as "PROMUNCH" in all caps. NEVER use em dashes or en dashes anywhere; use commas or full stops.\n\n` +
    `CLASSIFY the latest message into exactly one category:\n` +
    `- "collab": an influencer / creator / page proposing a collaboration, barter, paid promo, shoutout, "PR", "sponsorship", sending a media kit, or asking to work together.\n` +
    `- "order": a customer question about products, flavours, price, an order, delivery, refund, or where to buy.\n` +
    `- "spam": irrelevant, abusive, bots, generic "grow your followers" / "I can boost your page" pitches, crypto, or empty/emoji-only noise.\n` +
    `- "unknown": anything that does not clearly fit the above.\n\n` +
    `HOW TO REPLY by category:\n` +
    `- order: answer helpfully using the KNOWLEDGE BASE below. Never invent prices, policies, or facts; if the KB lacks it, say the team will follow up.\n` +
    (scope === "all"
      ? `- collab: respond warmly and, if it is a genuine barter/collab fit, share the barter terms below and ask for their details (handle, follower count, what they'd post). Our team will confirm.\n`
      : `- collab: reply with a SHORT warm acknowledgement only (e.g. thank them and say our team will review and reach out). Do NOT negotiate or quote full terms yourself.\n`) +
    `- spam: set reply to an empty string "" (we will not respond).\n` +
    `- unknown: a brief, friendly clarifying reply.\n\n` +
    (barterTerms ? `BARTER TERMS (only use for collab when allowed):\n${barterTerms}\n\n` : "") +
    `Set "escalate": true when the message is a collab inquiry OR needs a human (an order problem, refund, complaint, or anything you cannot resolve from the KB). Otherwise false.\n\n` +
    `Reply with JSON ONLY, no prose, no markdown fences:\n` +
    `{\n` +
    `  "classification": "collab|order|spam|unknown",\n` +
    `  "reply": "<your Instagram reply — empty string \\"\\" only for spam>",\n` +
    `  "escalate": <true|false>\n` +
    `}`
  );
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const { thread_id, last_message, inbound_id, kind, comment_id, draft, job_id } =
    (await req.json()) as InvokeBody;
  if (!thread_id) return j({ error: "thread_id required" }, 400);

  const sb = db();

  const [{ data: thread }, { data: settings }] = await Promise.all([
    sb.from("ig_threads").select("id, ig_user_id, handle, status, classification, collab_stage").eq("id", thread_id).maybeSingle(),
    sb.from("ig_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (!thread) return j({ error: "thread not found" }, 404);

  // Global pause kill-switch.
  if (!draft && settings?.paused) {
    await markJobDone(job_id);
    return j({ ok: true, action: "skipped", reason: "paused" });
  }

  // recent conversation context
  const { data: msgs } = await sb
    .from("ig_messages")
    .select("id, direction, text, created_at, sent_by")
    .eq("thread_id", thread_id)
    .order("created_at", { ascending: false })
    .limit(12);
  const ordered = (msgs ?? []).reverse();
  const history = ordered
    .map((m) => `${m.direction === "inbound" ? "User" : "PROMUNCH"}: ${m.text ?? ""}`)
    .join("\n");

  const answerInbound = inbound_id
    ? { id: inbound_id }
    : ([...ordered].reverse().find((m) => m.direction === "inbound") as { id: string } | undefined);

  let latest = last_message;
  if (!latest) latest = [...ordered].reverse().find((m) => m.direction === "inbound")?.text ?? "";
  if (!latest) return j({ error: "no message to answer" }, 400);

  const kb = await retrieveKb(sb, latest);
  const scope = settings?.auto_reply_scope ?? "routine_only";
  const barterTerms = settings?.barter_terms ?? null;

  const userMsg = [
    `KNOWLEDGE BASE:\n${kb || "(empty — no documents added yet)"}`,
    "",
    `CONVERSATION SO FAR:\n${history || "(none)"}`,
    "",
    `LATEST MESSAGE (${kind === "comment" ? "comment on our post" : "direct message"}):\n${latest}`,
    "",
    "Respond with JSON only.",
  ].join("\n");

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  let resp: any;
  let usage: unknown = null;
  try {
    resp = await chatCreate(client, {
      model: MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt(scope, barterTerms) },
        { role: "user", content: userMsg },
      ],
    });
    usage = resp.usage;
  } catch (e) {
    return j({ ok: false, error: String(e) }, 502);
  }

  const decision = parseDecision(resp?.choices?.[0]?.message?.content ?? "");
  const classification = ["collab", "order", "spam", "unknown"].includes(decision?.classification)
    ? decision.classification
    : "unknown";
  const replyText = (decision?.reply ?? "").toString().trim();
  const escalate = !!decision?.escalate || classification === "collab";

  // ---- draft mode: no side effects ----
  if (draft) {
    return j({ ok: true, draft: replyText, classification, escalate });
  }

  // Persist the classification on the thread regardless of whether we reply.
  const threadPatch: Record<string, unknown> = { classification, updated_at: new Date().toISOString() };
  if (classification === "collab" && !thread.collab_stage) threadPatch.collab_stage = "new";

  // Decide whether to send a reply.
  const autoReplyOn = settings?.auto_reply_enabled !== false;
  const commentsOn = settings?.auto_reply_comments !== false;
  const isComment = kind === "comment" && !!comment_id;
  const wantSend =
    autoReplyOn &&
    classification !== "spam" &&
    replyText.length > 0 &&
    (!isComment || commentsOn);

  let sent = false;
  if (wantSend) {
    const turn = await claimReplyTurn(sb, thread_id, answerInbound);
    if (turn.send) {
      // First contact from a comment must go out as a Private Reply (the only
      // official way to open a DM); subsequent messages are normal DMs.
      const priorOutbound = ordered.some((m) => m.direction === "outbound");
      const useReply = isComment && !priorOutbound;
      const res = await callSend(
        useReply
          ? { thread_id, kind: "private_reply", comment_id, text: replyText, sent_by: "bot", ai_generated: true, ai_meta: { model: MODEL, usage } }
          : { thread_id, kind: "text", text: replyText, sent_by: "bot", ai_generated: true, ai_meta: { model: MODEL, usage } },
      );
      if (res?.ok) {
        sent = true;
        await markReplyTurnSent(sb, thread_id, answerInbound);
      } else {
        await releaseReplyTurn(sb, thread_id, answerInbound);
      }
    }
  }

  await sb.from("ig_threads").update(threadPatch).eq("id", thread_id);

  // Escalate collab inquiries / unresolved issues to a human.
  if (escalate && settings?.escalate_to_slack !== false) {
    await escalateToSlack(sb, thread, classification, latest, sent).catch((e) =>
      console.error("[ig-ai-reply] escalation failed", e));
  }

  await markJobDone(job_id);
  return j({ ok: true, action: sent ? "replied" : "triaged", classification, escalated: escalate });
});

// ---- Slack escalation + collab enrichment ---------------------------------
async function escalateToSlack(sb: any, thread: any, classification: string, latest: string, replied: boolean) {
  // Mark a ticket on the thread so the dashboard surfaces it.
  await sb.from("ig_threads").update({
    ticket_status: "open",
    ticket_category: classification === "collab" ? "partnership" : "support",
    ticket_priority: classification === "collab" ? "normal" : "high",
    ticket_opened_at: new Date().toISOString(),
    escalation_reason: latest.slice(0, 300),
  }).eq("id", thread.id);

  // For a collab inquiry, enrich with official public metrics (Business
  // Discovery — no scraping) and flag whether they fit the target micro band.
  let metricsLine = "";
  if (classification === "collab" && thread.handle) {
    const { data: s } = await sb.from("ig_settings").select("min_followers, max_followers").eq("id", 1).maybeSingle();
    const min = s?.min_followers ?? 20000;
    const max = s?.max_followers ?? 100000;
    const bd = await businessDiscovery(thread.handle).catch(() => null);
    if (bd && (bd.followers != null || bd.engagement_rate != null)) {
      const fit = bd.followers != null && bd.followers >= min && bd.followers <= max;
      await sb.from("ig_threads").update({
        followers: bd.followers,
        engagement_rate: bd.engagement_rate,
        band_fit: bd.followers != null ? fit : null,
      }).eq("id", thread.id);
      const erPct = bd.engagement_rate != null ? `${(bd.engagement_rate * 100).toFixed(1)}%` : "?";
      metricsLine =
        `\n*Followers:* ${bd.followers ?? "?"}  ·  *ER:* ${erPct}  ·  ` +
        `*Band fit (${min / 1000}k–${max / 1000}k):* ${bd.followers != null ? (fit ? "✅ yes" : "❌ no") : "?"}`;
    }
  }

  const channel = slackChannelFor("instagram");
  if (!channel) return;
  const heading = classification === "collab"
    ? "🤝 Instagram collab inquiry"
    : "🎫 Instagram DM needs a human";
  const handle = thread.handle ? `@${thread.handle}` : `(IGSID ${thread.ig_user_id})`;
  const text = [
    `${heading} — *${handle}*`,
    `*Message:* ${latest.slice(0, 400)}`,
    metricsLine,
    `*Bot replied:* ${replied ? "yes (acknowledged)" : "no"}  ·  *thread:* ${thread.id}`,
  ].filter(Boolean).join("\n");
  await postSlack(channel, text);
}

// ---- KB retrieval (semantic with full-KB fallback, mirrors wa-ai-reply) ----
async function retrieveKb(sb: any, query: string): Promise<string> {
  try {
    const emb = await embedText(query);
    if (emb) {
      const { data, error } = await sb.rpc("match_kb_chunks", {
        query_embedding: emb,
        match_threshold: 0.25,
        match_count: 10,
      });
      if (!error && Array.isArray(data) && data.length) {
        let kb = "";
        for (const r of data) {
          const block = String(r.content ?? "").trim();
          if (!block) continue;
          if (kb.length + block.length + 2 > KB_CHAR_BUDGET) break;
          kb += (kb ? "\n\n" : "") + block;
        }
        if (kb) return kb;
      }
    }
  } catch (e) {
    console.error("[ig-ai-reply] KB retrieval failed — falling back to full KB", e);
  }
  return await stuffAllDocs(sb);
}

async function stuffAllDocs(sb: any): Promise<string> {
  const { data: docs } = await sb.from("kb_documents").select("name, raw_text").eq("status", "ready");
  const masterRank = (n: string) => (/master|policy|policies|pricing|faq/i.test(n) ? 0 : 1);
  const ready = (docs ?? [])
    .filter((d: any) => d.raw_text && String(d.raw_text).trim())
    .sort((a: any, b: any) => masterRank(a.name) - masterRank(b.name));
  let kb = "";
  for (const d of ready) {
    const block = `## ${d.name}\n${d.raw_text}`;
    if (kb.length + block.length + 2 > KB_CHAR_BUDGET) {
      const room = KB_CHAR_BUDGET - kb.length - 2;
      if (room > 200) kb += (kb ? "\n\n" : "") + block.slice(0, room);
      break;
    }
    kb += (kb ? "\n\n" : "") + block;
  }
  return kb;
}

async function embedText(text: string): Promise<number[] | null> {
  const t = text.trim().slice(0, 8000);
  if (!t) return null;
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const model = Deno.env.get("WA_EMBED_MODEL") ?? "text-embedding-3-small";
  const resp = await client.embeddings.create({ model, input: t });
  return (resp.data?.[0]?.embedding as number[]) ?? null;
}

// ---- OpenAI call with transient retry (mirrors wa-ai-reply) ----------------
async function chatCreate(client: OpenAI, params: any, retries = 2): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await client.chat.completions.create(params);
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status && status !== 429 && status < 500) break;
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---- NO-SPAM per-turn reply claim (mirrors wa-ai-reply) --------------------
async function claimReplyTurn(
  sb: any,
  threadId: string,
  inbound: { id: string } | undefined,
): Promise<{ send: boolean; reason?: string }> {
  if (!inbound) return { send: true };
  const { data: won, error } = await sb.rpc("claim_ig_reply", { p_thread: threadId, p_inbound: inbound.id });
  if (!error) return won === true ? { send: true } : { send: false, reason: "claimed_elsewhere" };
  // RPC not deployed yet — best-effort read fallback.
  const { data: replied } = await sb
    .from("ig_messages").select("id")
    .eq("thread_id", threadId).eq("direction", "outbound").eq("sent_by", "bot")
    .limit(1);
  return replied && replied.length ? { send: false, reason: "already_replied" } : { send: true };
}

async function markReplyTurnSent(sb: any, threadId: string, inbound?: { id: string }) {
  if (!inbound) return;
  await sb.rpc("mark_ig_reply_sent", { p_thread: threadId, p_inbound: inbound.id }).then(() => {}, () => {});
}

async function releaseReplyTurn(sb: any, threadId: string, inbound?: { id: string }) {
  if (!inbound) return;
  await sb.rpc("release_ig_reply", { p_thread: threadId, p_inbound: inbound.id }).then(() => {}, () => {});
}

async function markJobDone(jobId?: string | null) {
  if (!jobId) return;
  await db().from("ig_jobs").update({ status: "done", last_error: null }).eq("id", jobId).then(() => {}, () => {});
}

async function callSend(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ig-send`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await r.json().catch(() => ({ ok: false, error: "send response unparseable" }));
}

// ---- robust JSON parse (mirrors wa-ai-reply) -------------------------------
function parseDecision(s: string): any {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const open = t.indexOf("{");
  const close = t.lastIndexOf("}");
  if (open === -1 || close <= open) return looseReply(s);
  const body = t.slice(open, close + 1);
  return tryJson(body) ?? tryJson(repairJson(body)) ?? looseReply(body);
}

function tryJson(s: string): any {
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

function repairJson(s: string): string {
  let res = "";
  let inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { res += ch; esc = false; continue; }
    if (ch === "\\") { res += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; res += ch; continue; }
    if (inStr && (ch === "\n" || ch === "\r")) { res += "\\n"; continue; }
    if (inStr && ch === "\t") { res += "\\t"; continue; }
    res += ch;
  }
  return res.replace(/,\s*([}\]])/g, "$1");
}

function looseReply(s: string): any {
  const m = s.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const cm = s.match(/"classification"\s*:\s*"(\w+)"/);
  if (!m && !cm) return null;
  const reply = m ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : "";
  return { reply, classification: cm?.[1] ?? "unknown", escalate: /"escalate"\s*:\s*true/.test(s) };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
