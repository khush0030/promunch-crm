// AI customer-support agent for WhatsApp.
//
// The knowledge base is prompt-stuffed — every "ready" kb_documents row's text
// is loaded straight into Claude's context. No embeddings, no vector search,
// no OpenAI dependency. Right-sized for a small-business FAQ/policy KB.
//
// Modes:
//   normal  — decide reply|escalate, then send via wa-send / open a ticket
//   draft   — return the suggested reply text only (no send, no escalate);
//             used by the dashboard "AI draft" button.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { db } from "../_shared/supabase.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("WA_AI_MODEL") ?? "claude-sonnet-4-6";
const KB_CHAR_BUDGET = 60_000;

const SYSTEM_PROMPT = `You are the WhatsApp customer-support agent for PROMUNCH (a snack brand under Vippy Industries Limited — protein munchies, edamame snacks, "Your Munchy Pal").

Channel: WhatsApp. Keep replies SHORT (1-4 sentences), warm, conversational, India-English. No long paragraphs.

Use the KNOWLEDGE BASE below to answer factually. If the KB does not cover the answer, do NOT invent — escalate.

Output JSON ONLY, no prose, matching:
{
  "action": "reply" | "escalate",
  "text": "<the WhatsApp reply, if action=reply>",
  "reason": "<why escalated, if action=escalate>",
  "ticket_category": "order_issue|refund|product_query|partnership|complaint|wholesale|general" (only if escalate),
  "ticket_priority": "low|normal|high|urgent" (only if escalate)
}

Escalate when:
- The customer asks about a specific order/refund/return needing human action.
- They are angry, threatening, or report a quality/safety issue.
- They want bulk/wholesale/distributor/partnership terms.
- The KB does not contain the info needed.

Never make promises about delivery dates or refunds you cannot back from the KB.`;

interface InvokeBody {
  thread_id: string;
  last_message?: string;
  draft?: boolean;
  job_id?: string | null;
  image_url?: string | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const { thread_id, last_message, draft, job_id, image_url } = (await req.json()) as InvokeBody;
  if (!thread_id) return j({ error: "thread_id required" }, 400);

  const sb = db();

  // recent conversation context
  const { data: msgs } = await sb
    .from("wa_messages")
    .select("direction,body,created_at")
    .eq("thread_id", thread_id)
    .order("created_at", { ascending: false })
    .limit(12);
  const ordered = (msgs ?? []).reverse();
  const history = ordered
    .map((m) => `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body ?? ""}`)
    .join("\n");

  // resolve the message to answer — fall back to the latest inbound
  let latest = last_message;
  if (!latest) {
    const lastInbound = [...ordered].reverse().find((m) => m.direction === "inbound");
    latest = lastInbound?.body ?? "";
  }
  if (image_url && (!latest || /^\[image\]$/i.test(latest.trim()))) {
    latest = "(The customer sent an image with no caption — look at the attached image and respond.)";
  }
  if (!latest) return j({ error: "no customer message to answer" }, 400);

  // knowledge base — every ready document, prompt-stuffed
  const { data: docs } = await sb
    .from("kb_documents")
    .select("name, raw_text")
    .eq("status", "ready");
  let kb = (docs ?? [])
    .filter((d) => d.raw_text && String(d.raw_text).trim())
    .map((d) => `## ${d.name}\n${d.raw_text}`)
    .join("\n\n");
  if (kb.length > KB_CHAR_BUDGET) kb = kb.slice(0, KB_CHAR_BUDGET);

  const userMsg = [
    `KNOWLEDGE BASE:\n${kb || "(empty — no documents added yet)"}`,
    "",
    `CONVERSATION SO FAR:\n${history}`,
    "",
    `LATEST CUSTOMER MESSAGE:\n${latest}`,
    "",
    "Respond with JSON only.",
  ].join("\n");

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  // when the customer sent an image, attach it so Claude can see it
  const content: any = image_url
    ? [
        { type: "image", source: { type: "url", url: image_url } },
        { type: "text", text: userMsg },
      ]
    : userMsg;
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const rawTxt = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
  const decision = parseDecision(rawTxt);

  // ---- draft mode: return the suggestion only, no side effects ----
  if (draft) {
    if (!decision) return j({ ok: false, error: "AI output unparseable" }, 502);
    return j({
      ok: true,
      action: decision.action,
      draft: decision.action === "reply" ? (decision.text ?? "") : "",
      reason: decision.reason ?? null,
    });
  }

  // ---- normal mode: send or escalate ----
  // Each outcome below is a terminal success for the durable wa_jobs row —
  // a decision was produced — so mark the job done to stop cron retries.
  if (!decision) {
    await escalate(thread_id, "AI output unparseable", "general", "normal");
    await markJobDone(job_id);
    return j({ ok: false, action: "escalate", reason: "unparseable" });
  }

  if (decision.action === "reply" && decision.text) {
    await callSend({
      thread_id,
      kind: "text",
      text: decision.text,
      sent_by: "bot",
      ai_generated: true,
      ai_meta: { model: MODEL, usage: resp.usage },
    });
    await markJobDone(job_id);
    return j({ ok: true, action: "reply" });
  }

  await escalate(
    thread_id,
    decision.reason ?? "AI requested escalation",
    decision.ticket_category ?? "general",
    decision.ticket_priority ?? "normal",
  );
  await markJobDone(job_id);
  return j({ ok: true, action: "escalate" });
});

// Mark the durable wa_jobs row done so wa-jobs-tick won't retry it.
// No-op for draft mode / dashboard calls, which carry no job_id.
async function markJobDone(jobId?: string | null) {
  if (!jobId) return;
  await db().from("wa_jobs").update({ status: "done", last_error: null })
    .eq("id", jobId).then(() => {}, () => {});
}

function parseDecision(s: string): any {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function escalate(threadId: string, reason: string, category: string, priority: string) {
  const sb = db();
  await sb.from("wa_threads").update({
    status: "human",
    ticket_status: "open",
    ticket_priority: priority,
    ticket_category: category,
    ticket_opened_at: new Date().toISOString(),
    escalation_reason: reason,
  }).eq("id", threadId);

  const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
  if (webhook) {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🆘 WA ticket opened — ${category} / ${priority}\nReason: ${reason}\nThread: ${threadId}` }),
    }).catch(() => {});
  }
}

async function callSend(body: unknown) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
