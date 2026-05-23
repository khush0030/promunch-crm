// AI customer-support agent for WhatsApp.
//
// The knowledge base is prompt-stuffed — every "ready" kb_documents row's text
// is loaded straight into Claude's context. The agent also has one tool,
// lookup_order, to read a customer's Shopify orders from shopify_orders.
//
// Modes:
//   normal — reply to the customer; raise a ticket / hand off as side effects
//   draft  — return the suggested reply only (dashboard "AI draft" button)

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { lookupOrders, orderForAI, type OrderSummary } from "../_shared/orders.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = Deno.env.get("WA_AI_MODEL") ?? "gpt-4o-mini";
// 12K chars ≈ 3K tokens. The agent re-sends the KB on every tool-loop turn,
// so this is the single biggest input-cost lever for this function — was
// 60K, dropped to 12K (~5× cheaper per conversation).
const KB_CHAR_BUDGET = 12_000;
const MAX_TOOL_TURNS = 4;

const SYSTEM_PROMPT =
  `You are the WhatsApp customer-support agent for PROMUNCH (a snack brand under Vippy Industries Limited — protein munchies, edamame snacks, "Your Munchy Pal").

Channel: WhatsApp. Keep replies SHORT (1-4 sentences), warm, conversational, India-English. No long paragraphs.

You ALWAYS reply to the customer yourself, using the KNOWLEDGE BASE below. You are a capable support agent: handle product questions, order questions, complaints, refund/return requests and wholesale enquiries by replying helpfully.

ORDER LOOKUP — you have a tool, lookup_order. The customer's phone number is ALREADY KNOWN from WhatsApp — NEVER ask the customer for their phone or contact number. Whenever the customer mentions an order, a delivery, tracking, a missing / wrong / damaged item, a refund or a return: call lookup_order FIRST (no arguments lists their recent orders; pass order_number ONLY if the customer actually stated one). Then reply using the real order details. Only if the lookup returns nothing do you ask the customer for their order number — never their phone number.

CRITICAL — do not invent anything:
- NEVER guess or make up an order number. If the customer did not state one, call lookup_order with NO arguments.
- NEVER describe a problem, missing item, delay, damage or complaint the customer did not actually state. Act ONLY on what the customer really said in this conversation. If they simply ask "where is my order", just look it up and tell them its real status — do not invent an issue or raise an order-problem ticket.

HANDOFF — the ONLY reason to hand the chat to a human:
- The customer EXPLICITLY asks to talk to a human / agent / person / "real" support / staff member.
Nothing else triggers a handoff. You keep handling angry customers, refunds and order problems yourself.

TICKETS — raise a ticket so the team can follow up, WITHOUT handing off, whenever the conversation needs team action: a missing / wrong / damaged item, an order not delivered, a refund/return, a complaint, a quality/safety report, or a wholesale/partnership lead. When the ticket is about a specific order, ALWAYS put that order's number in the ticket "order_number" field — the team's escalation card is built from it. Raising a ticket does NOT stop you replying — you still answer and reassure the customer in the same message.

If the knowledge base or the order data lacks something, still reply: tell the customer you've logged it and the team will follow up. Never invent prices, dates, policies, or order facts.

After any tool calls, your FINAL message must be JSON ONLY, no prose:
{
  "reply": "<your WhatsApp reply to the customer — ALWAYS required, never empty>",
  "handoff": <true ONLY if the customer explicitly asked for a human, otherwise false>,
  "ticket": <null, OR { "category": "order_issue|refund|product_query|partnership|complaint|wholesale|general", "priority": "low|normal|high|urgent", "reason": "<one clear line for the team — what went wrong, which item/order>", "order_number": "<the order number this ticket is about, if any>" }>
}`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "lookup_order",
      description:
        "Look up this customer's Shopify order(s). Their phone number is already " +
        "known from WhatsApp — NEVER ask the customer for it. Call with no arguments " +
        "to list their recent orders; pass order_number to fetch a specific one. Use " +
        "this whenever the customer mentions an order, delivery, tracking, a missing / " +
        "wrong / damaged item, a refund or a return.",
      parameters: {
        type: "object",
        properties: {
          order_number: {
            type: "string",
            description: "Optional order number if the customer gave one, e.g. '1042' or '#1042'.",
          },
        },
      },
    },
  },
];

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

  // thread — wa_id is the customer's phone, used for order lookup
  const { data: thread } = await sb
    .from("wa_threads")
    .select("wa_id, ticket_status")
    .eq("id", thread_id)
    .maybeSingle();
  const waId: string | null = thread?.wa_id ?? null;

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

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  // When the customer sent an image, attach it so the vision model can see it
  // (OpenAI mixes text + image_url content parts on a single user message).
  const firstContent: any = image_url
    ? [
        { type: "text", text: userMsg },
        { type: "image_url", image_url: { url: image_url } },
      ]
    : userMsg;

  // ---- agent loop: let the model call lookup_order before its final answer ----
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: firstContent },
  ];
  let resp: any = null;
  let lastUsage: unknown = null;
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 900,
      tools: TOOLS,
      messages,
    });
    lastUsage = resp.usage;
    const choice = resp.choices?.[0];
    const toolCalls = choice?.message?.tool_calls ?? [];
    if (!toolCalls.length) break;

    // The assistant turn (which contains the tool_calls) goes back in verbatim.
    messages.push(choice.message);
    for (const call of toolCalls) {
      let result = "Unknown tool.";
      if (call.function?.name === "lookup_order") {
        let arg: { order_number?: string } = {};
        try { arg = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
        const askedNo = (arg.order_number ?? "").toString().trim();
        const orders = await lookupOrders(waId, askedNo || null)
          .catch((e) => {
            console.error("[wa-ai-reply] lookup_order failed", e);
            return null;
          });
        if (orders === null) {
          result = "Order lookup failed — tell the customer the team will check and follow up.";
        } else if (orders.length === 0) {
          result = askedNo
            ? `No order matching '${askedNo}' was found. Ask the customer to double-check the ` +
              `order number. Do NOT ask for a phone number.`
            : "This customer has no orders on file under their WhatsApp number. Politely ask them " +
              "for their order number. Do NOT ask for a phone number, and do NOT guess one.";
        } else {
          result = orders.map(orderForAI).join("\n\n---\n\n");
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  const decision = parseDecision(textOf(resp));

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
  // side effects layered on top — never a substitute for replying.
  const replyText = decision?.reply?.trim() ||
    "Thanks for messaging PROMUNCH! 🥜 I've noted this — our team will follow up with you shortly.";

  await callSend({
    thread_id,
    kind: "text",
    text: replyText,
    sent_by: "bot",
    ai_generated: true,
    ai_meta: { model: MODEL, usage: lastUsage },
  });

  // Hand off ONLY when the customer explicitly asked for a human.
  // Raise a ticket when the AI flagged one — or, if the AI output was
  // unparseable, as a general ticket so nothing slips by silently.
  const handoff = !!decision?.handoff;
  const ticket: TicketInput | null = decision
    ? (decision.ticket ?? null)
    : { category: "general", priority: "normal", reason: "AI output unparseable — review chat" };
  if (handoff || ticket) await openTicket(thread_id, waId, ticket, handoff);

  await markJobDone(job_id);
  return j({ ok: true, action: handoff ? "handoff" : "reply", ticket: !!ticket });
});

// Final assistant text from an OpenAI chat-completion response.
function textOf(resp: any): string {
  return resp?.choices?.[0]?.message?.content ?? "";
}

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

interface TicketInput {
  category?: string;
  priority?: string;
  reason?: string;
  order_number?: string;
}

// Raise / refresh a support ticket on the thread, then post a Slack escalation.
//   handoff=false → ticket only; the thread stays 'bot' and the AI keeps
//                   replying. This is the normal case.
//   handoff=true  → also flip the thread to 'human' so the bot goes quiet and
//                   a person takes over. ONLY when the customer asked for one.
async function openTicket(
  threadId: string,
  waId: string | null,
  ticket: TicketInput | null,
  handoff: boolean,
) {
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

  // when the ticket names an order, pull it from the DB so the escalation
  // card carries verified details — never the model's recollection.
  let order: OrderSummary | null = null;
  if (ticket?.order_number) {
    const found = await lookupOrders(waId, ticket.order_number).catch(() => [] as OrderSummary[]);
    order = found[0] ?? null;
  }

  await postEscalation({
    threadId,
    waId,
    handoff,
    category: String(upd.ticket_category),
    priority: String(upd.ticket_priority),
    reason,
    order,
  });
}

// Post the escalation to Slack — a rich card the production / ops team acts on.
async function postEscalation(o: {
  threadId: string;
  waId: string | null;
  handoff: boolean;
  category: string;
  priority: string;
  reason: string;
  order: OrderSummary | null;
}) {
  const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!webhook) return;

  const heading = o.handoff
    ? `🙋 Human handoff requested — ${o.priority.toUpperCase()}`
    : o.order
      ? `🏭 Order issue — needs the team — ${o.priority.toUpperCase()}`
      : `🎫 Ticket raised by AI — ${o.priority.toUpperCase()}`;

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: heading } },
    { type: "section", text: { type: "mrkdwn", text: `*Issue*\n${o.reason}` } },
  ];

  if (o.order) {
    const items = o.order.items.map((i) => `• ${i.qty} × ${i.name}`).join("\n") || "_none_";
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Order*\n${o.order.order_number}` },
        { type: "mrkdwn", text: `*Placed*\n${o.order.placed_at}` },
        { type: "mrkdwn", text: `*Payment*\n${o.order.financial_status ?? "—"}` },
        { type: "mrkdwn", text: `*Fulfillment*\n${o.order.fulfillment_status}` },
        { type: "mrkdwn", text: `*Total*\n${o.order.total}` },
        { type: "mrkdwn", text: `*Customer*\n${o.order.customer_name ?? "—"}` },
      ],
    });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Items*\n${items}` } });
    if (o.order.tracking) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Tracking*\n${o.order.tracking}` } });
    }
  }

  const contact = [
    o.waId ? `WhatsApp: +${o.waId}` : null,
    o.order?.customer_email ? `Email: ${o.order.customer_email}` : null,
  ].filter(Boolean).join("  ·  ");
  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `${contact || "—"}  ·  category: ${o.category}  ·  thread: ${o.threadId}`,
    }],
  });

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `${heading} — ${o.reason}`, blocks }),
  }).catch(() => {});
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
