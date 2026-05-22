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

You ALWAYS reply to the customer yourself, using the KNOWLEDGE BASE below. You are a capable support agent: handle product questions, order questions, complaints, refund/return requests and wholesale enquiries by replying helpfully and gathering any details the team would need.

HANDOFF — the ONLY reason to hand the chat to a human:
- The customer EXPLICITLY asks to talk to a human / agent / person / "real" support / staff member.
Nothing else triggers a handoff. Angry customers, refunds, missing order info — you still handle those and reply yourself.

TICKETS — raise a ticket so the team can follow up, WITHOUT handing off, whenever the conversation involves something to track: an order problem, a refund/return, a complaint, a quality/safety report, or a wholesale/partnership lead. Raising a ticket does NOT stop you replying — you still answer the customer in the same message.

If the KB lacks a specific live fact (e.g. the status of one customer's order), still reply: tell the customer you've logged it and the team will follow up, and raise a ticket. Never invent prices, dates, or policies that are not in the KB.

Output JSON ONLY, no prose:
{
  "reply": "<your WhatsApp reply to the customer — ALWAYS required, never empty>",
  "handoff": <true ONLY if the customer explicitly asked for a human, otherwise false>,
  "ticket": <null, OR { "category": "order_issue|refund|product_query|partnership|complaint|wholesale|general", "priority": "low|normal|high|urgent", "reason": "<one short line for the team>" }>
}`;

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

  // ---- draft mode: return the suggested reply only, no side effects ----
  if (draft) {
    if (!decision?.reply) return j({ ok: false, error: "AI output unparseable" }, 502);
    return j({
      ok: true,
      draft: decision.reply,
      action: decision.handoff ? "handoff" : "reply",
      handoff: !!decision.handoff,
      ticket: decision.ticket ?? null,
      reason: decision.ticket?.reason ?? null,
    });
  }

  // ---- normal mode ----
  // The bot ALWAYS replies. Opening a ticket or handing off to a human are
  // side effects layered on top — never a substitute for replying. The
  // durable wa_jobs row is "done" the moment a reply goes out.
  const replyText = decision?.reply?.trim() ||
    "Thanks for messaging PROMUNCH! 🥜 I've noted this — our team will follow up with you shortly.";

  await callSend({
    thread_id,
    kind: "text",
    text: replyText,
    sent_by: "bot",
    ai_generated: true,
    ai_meta: { model: MODEL, usage: resp.usage },
  });

  // Hand off ONLY when the customer explicitly asked for a human.
  // Raise a ticket when the AI flagged one — or, if the AI output was
  // unparseable, as a general ticket so nothing slips by silently.
  const handoff = !!decision?.handoff;
  const ticket = decision
    ? (decision.ticket ?? null)
    : { category: "general", priority: "normal", reason: "AI output unparseable — review chat" };
  if (handoff || ticket) await openTicket(thread_id, ticket, handoff);

  await markJobDone(job_id);
  return j({ ok: true, action: handoff ? "handoff" : "reply", ticket: !!ticket });
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

interface Ticket { category?: string; priority?: string; reason?: string }

// Raise / refresh a support ticket on the thread.
//   handoff=false → ticket only; the thread stays 'bot' and the AI keeps
//                   replying. This is the normal case.
//   handoff=true  → also flip the thread to 'human' so the bot goes quiet and
//                   a person takes over. ONLY when the customer asked for one.
async function openTicket(threadId: string, ticket: Ticket | null, handoff: boolean) {
  const sb = db();
  const { data: thread } = await sb
    .from("wa_threads")
    .select("ticket_status")
    .eq("id", threadId)
    .maybeSingle();

  const reason = ticket?.reason ??
    (handoff ? "Customer asked to speak to a human" : "Ticket raised by AI agent");
  const upd: Record<string, unknown> = {
    ticket_status: "open",
    ticket_category: ticket?.category ?? "general",
    ticket_priority: ticket?.priority ?? (handoff ? "high" : "normal"),
    escalation_reason: reason,
  };
  // don't reset the opened-at clock on a ticket that is already open
  if (thread?.ticket_status !== "open") upd.ticket_opened_at = new Date().toISOString();
  // silence the bot ONLY on an explicit human request
  if (handoff) upd.status = "human";

  await sb.from("wa_threads").update(upd).eq("id", threadId);

  const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
  if (webhook) {
    const tag = handoff ? "🙋 Human handoff requested" : "🎫 Ticket raised by AI";
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${tag} — ${upd.ticket_category} / ${upd.ticket_priority}\nReason: ${reason}\nThread: ${threadId}`,
      }),
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
