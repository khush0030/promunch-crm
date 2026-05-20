// AI customer-support agent for WhatsApp.
// Flow:
//   1. Load last N messages of the thread for context.
//   2. Embed the latest inbound text and pull top-K KB chunks via match_kb_chunks.
//   3. Ask Claude to decide: { action: 'reply' | 'escalate', text?, reason? }.
//   4. On reply: call wa-send to deliver, persist ai_meta on the message.
//   5. On escalate: flip thread.status='human' + open ticket, post Slack alert
//      via existing slack-events helper (best-effort).

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { db } from "../_shared/supabase.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("WA_AI_MODEL") ?? "claude-sonnet-4-6";
const EMBED_MODEL = Deno.env.get("WA_EMBED_MODEL") ?? "text-embedding-3-small";

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

interface InvokeBody { thread_id: string; last_message: string }

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const { thread_id, last_message } = (await req.json()) as InvokeBody;
  if (!thread_id || !last_message) return j({ error: "thread_id and last_message required" }, 400);

  const sb = db();

  // recent context
  const { data: msgs } = await sb
    .from("wa_messages")
    .select("direction,body,created_at")
    .eq("thread_id", thread_id)
    .order("created_at", { ascending: false })
    .limit(10);
  const history = (msgs ?? []).reverse()
    .map((m) => `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body ?? ""}`)
    .join("\n");

  // RAG
  let kbContext = "";
  let kbHits: Array<{ id: string; similarity: number }> = [];
  if (OPENAI_API_KEY) {
    try {
      const embedding = await embed(last_message);
      const { data: hits } = await sb.rpc("match_kb_chunks", {
        query_embedding: embedding,
        match_threshold: 0.4,
        match_count: 6,
      });
      if (hits && hits.length) {
        kbHits = hits.map((h: any) => ({ id: h.id, similarity: h.similarity }));
        kbContext = hits.map((h: any, i: number) => `[KB ${i + 1}] ${h.content}`).join("\n\n");
      }
    } catch (e) {
      console.warn("[wa-ai-reply] embed/rag failed", e);
    }
  }

  // ask Claude
  const userMsg = [
    `KNOWLEDGE BASE:\n${kbContext || "(no relevant entries)"}`,
    "",
    `CONVERSATION SO FAR:\n${history}`,
    "",
    `LATEST CUSTOMER MESSAGE:\n${last_message}`,
    "",
    "Respond with JSON only.",
  ].join("\n");

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
  const decision = parseDecision(raw);

  if (!decision) {
    await escalate(thread_id, "AI output unparseable", "general", "normal");
    return j({ ok: false, action: "escalate", reason: "unparseable" });
  }

  if (decision.action === "reply" && decision.text) {
    await callSend({
      thread_id,
      kind: "text",
      text: decision.text,
      sent_by: "bot",
      ai_generated: true,
      ai_meta: { model: MODEL, kb_hits: kbHits, usage: resp.usage },
    });
    return j({ ok: true, action: "reply" });
  }

  await escalate(
    thread_id,
    decision.reason ?? "AI requested escalation",
    decision.ticket_category ?? "general",
    decision.ticket_priority ?? "normal",
  );
  return j({ ok: true, action: "escalate" });
});

function parseDecision(s: string): any {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function embed(text: string): Promise<number[]> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`embed http ${r.status}`);
  const j = await r.json();
  return j.data[0].embedding;
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

  // best-effort Slack ping
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
