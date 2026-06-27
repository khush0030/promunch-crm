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
import { stripEmDashes, type CatalogSection } from "../_shared/whatsapp.ts";
import {
  type DueAsk,
  claimAsk,
  findDueAsk,
  firstNameOf,
  releaseAsk,
} from "../_shared/window-asks.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = Deno.env.get("WA_AI_MODEL") ?? "gpt-4o-mini";
// 12K chars ≈ 3K tokens. The agent re-sends the KB on every tool-loop turn,
// so this is the single biggest input-cost lever for this function — was
// 60K, dropped to 12K (~5× cheaper per conversation).
const KB_CHAR_BUDGET = 12_000;
const MAX_TOOL_TURNS = 4;
const CATALOG_ID = Deno.env.get("WHATSAPP_CATALOG_ID") ?? "";
// Meta limits a product_list to 30 products across 10 sections.
const MAX_CATALOG_ITEMS = 30;
const MAX_CATALOG_SECTIONS = 10;

const SYSTEM_PROMPT =
  `You are the WhatsApp customer-support agent for PROMUNCH (a snack brand under Vippy Industries Limited — protein munchies, edamame snacks, "Your Munchy Pal").

Channel: WhatsApp. Keep replies SHORT (1-4 sentences), warm, conversational. No long paragraphs.

LANGUAGE: Reply in ENGLISH by default — clear, simple India-English. Only switch to Hindi/Hinglish if the customer clearly cannot follow English or explicitly asks; even then keep it simple. Do NOT mirror the customer into Hinglish just because they wrote one Hindi line.

ONE MESSAGE PER TURN: Answer the whole conversation in a SINGLE message. Never split your answer across multiple sends. If the customer sent several messages in a row, read all of them and reply ONCE, covering everything.

TONE — always patient, always kind: Customers may be confused, repetitive, or frustrated (e.g. about a charge they don't understand). NEVER be curt, dismissive or rude. Acknowledge their concern, explain calmly, and help them resolve it — even if they ask the same thing twice. If they point at something specific (a charge, a screenshot), address THAT exact thing using the knowledge base; don't deflect with a generic "team will follow up" when you can actually answer.

BRAND VOICE: PROMUNCH is "Your Munchy Pal" — warm and friendly. Do NOT write the "Your Munchy Pal" sign-off tagline yourself; the system appends it automatically, and only on the opening greeting and the closing message. Never repeat it mid-conversation.

COPY RULES (strict): Write the brand name as PROMUNCH in all caps. NEVER use an em dash or en dash (— or –) in your reply. Use a comma, a full stop, or rephrase into two short sentences instead. Plain hyphens inside words (e.g. high-protein, Jain-friendly) are fine.

You ALWAYS reply to the customer yourself, using the KNOWLEDGE BASE below. You are a capable support agent: handle product questions, order questions, complaints, refund/return requests and wholesale enquiries by replying helpfully.

ORDER LOOKUP — you have a tool, lookup_order. The customer's phone number is ALREADY KNOWN from WhatsApp — NEVER ask the customer for their phone or contact number. Whenever the customer mentions an order, a delivery, tracking, a missing / wrong / damaged item, a refund or a return: call lookup_order FIRST (no arguments lists their recent orders; pass order_number ONLY if the customer actually stated one). Then reply using the real order details. Only if the lookup returns nothing do you ask the customer for their order number — never their phone number.

ORDERING ON WHATSAPP — customers can shop right here in the chat. You have a tool, show_products. Call it whenever the customer wants to browse, see the menu, order, buy, reorder, or asks "what do you have" / "what flavours" / "I want X" (optionally pass a category like "crunchies" or "edamame" to narrow it). It shows them tappable product cards they add to a cart inside WhatsApp. They then send the cart back and AUTOMATICALLY receive a secure checkout link — the system handles that link, so NEVER write a checkout or cart URL yourself and never quote prices from memory (the cards show real live prices). After calling show_products your reply should be ONE short warm line, e.g. "Here's our menu — tap to add what you fancy 👇". Do NOT list the products as text.

ORDER CHANGES — you have a tool, request_order_change, for things the TEAM must action on an existing order: cancelling it, a return/replacement, or fixing the delivery address. Call lookup_order FIRST to get the real order number, then call request_order_change with change_type, order_number and details (for an address change, capture the FULL corrected address; for a return/cancel, which item(s) and why). It raises a priority ticket for the team — you still reply in the SAME turn, warmly confirming you've LOGGED the request and the team will sort it shortly. NEVER claim it is already cancelled / refunded / changed — you cannot do it yourself, only log it. CANCELLATION is EXPLICIT-ONLY: call request_order_change with change_type "cancel" ONLY when the customer clearly says they want to cancel their order. A one-word "stop" / "unsubscribe" is an opt-out from messages, NOT a cancellation — never treat it as one. If you are unsure whether they want to cancel, ASK them to confirm first.

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
  {
    type: "function" as const,
    function: {
      name: "show_products",
      description:
        "Show the customer PROMUNCH products as tappable WhatsApp catalog cards they " +
        "can add to a cart and order. Call this whenever the customer wants to browse, " +
        "see the menu, order, buy, reorder, or asks what's available. Optionally pass a " +
        "category to narrow the list. After this, the customer adds items to a cart and " +
        "receives a checkout link automatically — you never build links or quote prices.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Optional category/keyword to filter products, e.g. 'crunchies', 'edamame', 'protein'. Omit to show everything.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "request_order_change",
      description:
        "Log a request that needs the TEAM to act on an existing order: cancel it, " +
        "start a return/replacement, or fix the delivery address. The customer's " +
        "phone is already known. Call lookup_order first to get the real order " +
        "number. This raises a priority ticket — you still reply to reassure the " +
        "customer in the same turn, but you only LOG the request, you never perform it.",
      parameters: {
        type: "object",
        properties: {
          change_type: {
            type: "string",
            enum: ["cancel", "return", "replacement", "address_change"],
            description: "What the customer needs the team to do.",
          },
          order_number: {
            type: "string",
            description: "The order this is about, e.g. '1042' or '#1042'. Get it from lookup_order if the customer didn't state it.",
          },
          details: {
            type: "string",
            description: "Specifics the team needs: item(s) and reason; for address_change, the FULL corrected delivery address.",
          },
        },
        required: ["change_type", "details"],
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
  // Proactive in-window ask (driven by wa-journey-tick when the 24h service
  // window is open): generate ONE personalized free-text review/restock message.
  proactive_ask?: { run_id: string; journey_key: string; url?: string; name?: string };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const { thread_id, last_message, draft, job_id, image_url, proactive_ask } =
    (await req.json()) as InvokeBody;
  if (!thread_id) return j({ error: "thread_id required" }, 400);

  const sb = db();

  // thread — wa_id is the customer's phone, used for order lookup
  const { data: thread } = await sb
    .from("wa_threads")
    .select("wa_id, ticket_status")
    .eq("id", thread_id)
    .maybeSingle();
  const waId: string | null = thread?.wa_id ?? null;

  // ---- proactive in-window ask: standalone personalized message, no inbound ----
  if (proactive_ask) {
    return await handleProactiveAsk(sb, thread_id, waId, proactive_ask);
  }

  // recent conversation context
  const { data: msgs } = await sb
    .from("wa_messages")
    .select("id,direction,body,created_at,sent_by")
    .eq("thread_id", thread_id)
    .order("created_at", { ascending: false })
    .limit(12);
  const ordered = (msgs ?? []).reverse();
  const history = ordered
    .map((m) => `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body ?? ""}`)
    .join("\n");

  // NO-SPAM: the inbound turn this run is answering. Used right before we send
  // to (a) bow out if a newer customer message arrived — a later run will reply
  // to the fuller context (collapses a rapid-fire burst into ONE reply), and
  // (b) take an atomic per-turn claim so a concurrent run or a wa-jobs-tick
  // retry of an already-answered turn can never send a second time.
  const answerInbound = [...ordered].reverse().find((m) => m.direction === "inbound") as
    | { id: string; created_at: string }
    | undefined;

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

  // knowledge base — semantic retrieval over kb_chunks (embedded by kb-embed),
  // falling back to prompt-stuffing every ready document when no embeddings
  // exist yet. The fallback keeps the bot working before/independent of the
  // embedding pipeline, so this switch can never break replies.
  const kb = await retrieveKb(sb, latest);

  // ---- in-window piggyback: if a post-purchase ask is DUE and we're in an open
  // session, let the bot weave a PERSONALIZED review/restock ask into its reply.
  // Claim it FIRST (atomic) so the template timer can never also send it; if the
  // bot judges the mood wrong and omits the ask, we release the claim.
  let claimedAsk: DueAsk | null = null;
  // If the model calls show_products, we stash the prepared catalog here and
  // send it AFTER winning the per-turn claim (so a retry can't double-send).
  let pendingCatalog: { sections: CatalogSection[]; count: number } | null = null;
  // Structured order-change request from the request_order_change tool — becomes
  // THE ticket at the end (takes precedence over decision.ticket so we never
  // raise two escalations for the same turn).
  let pendingChange: { changeType: string; orderNumber: string | null; details: string } | null = null;
  if (!draft && waId) {
    const due = await findDueAsk(sb, waId, new Date().toISOString());
    if (due && (await claimAsk(sb, due.runId))) claimedAsk = due;
  }

  // Outside support hours, tell the bot to set follow-up expectations IF it
  // escalates. It still fully answers now. Skipped in draft mode (a human agent
  // is at the dashboard).
  const hoursNote = draft ? null : supportHoursNote();

  const userMsg = [
    `KNOWLEDGE BASE:\n${kb || "(empty — no documents added yet)"}`,
    "",
    `CONVERSATION SO FAR:\n${history}`,
    "",
    `LATEST CUSTOMER MESSAGE:\n${latest}`,
    claimedAsk ? "\n" + askInstruction(claimedAsk) : "",
    hoursNote ? "\n" + hoursNote : "",
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
    resp = await chatCreate(client, {
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
      } else if (call.function?.name === "show_products") {
        let arg: { category?: string } = {};
        try { arg = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
        if (!CATALOG_ID) {
          result = "Product catalog isn't configured yet — tell the customer that ordering on WhatsApp is coming very soon, and offer to help another way.";
        } else {
          const cat = await buildCatalogSections(sb, arg.category ?? null).catch((e) => {
            console.error("[wa-ai-reply] show_products failed", e);
            return null;
          });
          if (!cat || cat.count === 0) {
            result = (arg.category && arg.category.trim())
              ? `No products matched '${arg.category}'. Offer to show the full menu instead (call show_products with no category).`
              : "No products are available to show right now — tell the customer ordering is briefly unavailable and offer to help another way.";
          } else {
            pendingCatalog = { sections: cat.sections, count: cat.count };
            result = `Prepared ${cat.count} product card(s) (${cat.titles}). They WILL be shown to the customer automatically as tappable catalog cards. Reply with ONE short warm line inviting them to tap and add to cart — do NOT list the products in text and do NOT mention prices.`;
          }
        }
      } else if (call.function?.name === "request_order_change") {
        let arg: { change_type?: string; order_number?: string; details?: string } = {};
        try { arg = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
        const ct = (arg.change_type ?? "").toString().trim().toLowerCase();
        const details = (arg.details ?? "").toString().trim();
        if (!["cancel", "return", "replacement", "address_change"].includes(ct)) {
          result = "Ask the customer briefly what they need (cancel, return, replacement, or address change) before logging it.";
        } else if (!details) {
          result = "Need the specifics first — for an address change capture the FULL corrected address; for a return/cancel, which item(s) and why.";
        } else {
          pendingChange = {
            changeType: ct,
            orderNumber: (arg.order_number ?? "").toString().trim() || null,
            details,
          };
          result = `Logged a ${ct.replace("_", " ")} request for the team to action. Reply warmly that you've RAISED it and the team will sort it / follow up shortly — do NOT claim it is already done.`;
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // If the loop hit MAX_TOOL_TURNS while the model still wanted to call a tool,
  // `resp` is a tool-call response with no text — which would degrade to the
  // generic fallback reply AND a spurious "unparseable" ticket. Force ONE more
  // tool-free completion so the customer gets the real answer.
  if ((resp?.choices?.[0]?.message?.tool_calls ?? []).length > 0) {
    resp = await chatCreate(client, {
      model: MODEL,
      max_tokens: 900,
      tool_choice: "none",
      messages,
    });
    lastUsage = resp.usage;
  }

  const decision = parseDecision(textOf(resp));

  // If we claimed an in-window ask but the bot judged the mood wrong (or output
  // was unparseable) and left it out, hand the claim back so it's retried later.
  if (claimedAsk && decision?.included_ask !== true) {
    await releaseAsk(sb, claimedAsk.runId);
    claimedAsk = null;
  }

  // ---- draft mode: return the suggested reply only, no side effects ----
  if (draft) {
    if (!decision?.reply) return j({ ok: false, error: "AI output unparseable" }, 502);
    return j({
      ok: true,
      draft: stripEmDashes(decision.reply),
      action: decision.handoff ? "handoff" : "reply",
      handoff: !!decision.handoff,
      ticket: decision.ticket ?? null,
      reason: decision.ticket?.reason ?? null,
    });
  }

  // ---- normal mode ----
  // The bot ALWAYS replies. Opening a ticket or handing off to a human are
  // side effects layered on top — never a substitute for replying.
  // Brand tagline is appended HERE, deterministically — only on the opening
  // greeting (no prior bot reply in this thread) and on a closing/sign-off
  // message (customer thanked us / said bye). Never on every turn — that reads
  // robotic and spammy. First strip any tagline the model added on its own.
  const TAGLINE = "Your Munchy Pal 💚";
  let replyText = (decision?.reply?.trim() ||
    "Thanks for messaging PROMUNCH! 🥜 I've noted this — our team will follow up with you shortly.")
    .replace(/\s*[—–-]\s*your munchy pal\s*💚?\s*\.?\s*$/i, "")
    .trim();

  const priorBotReply = ordered.some((m) => m.direction === "outbound" && m.sent_by === "bot");
  const isOpening = !priorBotReply;
  const isClosing = /\b(thanks|thank you|thank u|thx|tysm|bye|goodbye|see you|that'?s all|that'?s it|nothing else|all good|no that'?s all|cheers)\b/i.test(latest ?? "");
  if (isOpening || isClosing) replyText = `${replyText}\n\n${TAGLINE}`;

  // ---- NO-SPAM: claim this turn before sending ----------------------------
  // A missed reply is recoverable (a later run or the cron picks it up); a
  // duplicate is not — it reads as spam. So bias toward NOT double-sending:
  // bow out if a newer message arrived (a later run answers the full context)
  // or if another run / retry already owns this turn.
  const turn = await claimReplyTurn(sb, thread_id, answerInbound);
  if (!turn.send) {
    if (claimedAsk) { await releaseAsk(sb, claimedAsk.runId); claimedAsk = null; }
    await markJobDone(job_id);
    return j({ ok: true, action: "skipped", reason: turn.reason });
  }

  const sent = await callSend({
    thread_id,
    kind: "text",
    text: replyText,
    sent_by: "bot",
    ai_generated: true,
    ai_meta: { model: MODEL, usage: lastUsage },
  });
  if (sent?.ok === false) {
    // release the claim so a retry can re-send, and surface the failure so
    // wa-jobs-tick retries this turn rather than dropping the customer.
    await releaseReplyTurn(sb, thread_id, answerInbound);
    return j({ ok: false, error: sent.error ?? "send failed" }, 502);
  }
  await markReplyTurnSent(sb, thread_id, answerInbound);

  // If the bot chose to show products, deliver the catalog cards now — AFTER the
  // text intro and gated by the per-turn claim we just won, so a concurrent run
  // or a wa-jobs-tick retry can never double-send the menu.
  if (pendingCatalog) {
    await callSend({
      thread_id,
      kind: "catalog",
      sent_by: "bot",
      catalog: {
        catalog_id: CATALOG_ID,
        header: "PROMUNCH menu",
        body: "Tap a product to add it to your cart 🛒",
        sections: pendingCatalog.sections,
      },
    }).catch((e) => console.error("[wa-ai-reply] catalog send failed", e));
  }

  // Hand off ONLY when the customer explicitly asked for a human.
  // Raise a ticket when the AI flagged one — or, if the AI output was
  // unparseable, as a general ticket so nothing slips by silently.
  const handoff = !!decision?.handoff;
  const ticket: TicketInput | null = pendingChange
    ? changeToTicket(pendingChange)
    : decision
    ? (decision.ticket ?? null)
    : { category: "general", priority: "normal", reason: "AI output unparseable — review chat" };
  if (handoff || ticket) await openTicket(thread_id, waId, ticket, handoff);

  // EXPLICIT cancellation → ping the ops "guard" on WhatsApp ASAP so the order is
  // pulled before dispatch. The urgent Slack card from openTicket is the
  // guaranteed path; this is an extra fast nudge to a human's phone. Best-effort,
  // gated on OPS_WA_ID being set — never blocks the customer reply.
  if (pendingChange?.changeType === "cancel") {
    await notifyOpsCancel(waId, pendingChange).catch((e) =>
      console.error("[wa-ai-reply] ops cancel ping failed", e));
  }

  await markJobDone(job_id);
  return j({ ok: true, action: handoff ? "handoff" : "reply", ticket: !!ticket });
});

// Final assistant text from an OpenAI chat-completion response.
function textOf(resp: any): string {
  return resp?.choices?.[0]?.message?.content ?? "";
}

// ---- Knowledge base retrieval ---------------------------------------------
// Embed the customer's message, pull the most relevant kb_chunks via the
// match_kb_chunks RPC, and assemble them within the char budget. Falls back to
// prompt-stuffing every ready document if embeddings aren't populated yet or
// anything goes wrong — the bot is never left without a KB.
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
    console.error("[wa-ai-reply] KB retrieval failed — falling back to full KB", e);
  }
  return await stuffAllDocs(sb);
}

// Legacy path: prompt-stuff all ready docs, Master/policy/pricing/FAQ first so
// they always land inside the budget; budget doc-by-doc (no silent mid-word cut
// of a whole later doc).
async function stuffAllDocs(sb: any): Promise<string> {
  const { data: docs } = await sb
    .from("kb_documents").select("name, raw_text").eq("status", "ready");
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

// ---- Support hours --------------------------------------------------------
// Returns a prompt note when the human team is OFFLINE (so the bot can set
// follow-up expectations when it escalates), or null when open. Configurable:
//   WA_BUSINESS_TZ (default Asia/Kolkata), WA_BUSINESS_OPEN/CLOSE ("HH:MM"),
//   WA_BUSINESS_DAYS (CSV, 0=Sun..6=Sat; default Mon–Sat).
function supportHoursNote(): string | null {
  try {
    const tz = Deno.env.get("WA_BUSINESS_TZ") ?? "Asia/Kolkata";
    const open = Deno.env.get("WA_BUSINESS_OPEN") ?? "10:00";
    const close = Deno.env.get("WA_BUSINESS_CLOSE") ?? "19:00";
    const days = (Deno.env.get("WA_BUSINESS_DAYS") ?? "1,2,3,4,5,6")
      .split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = wd[get("weekday")] ?? 1;
    const nowMin = Number(get("hour")) * 60 + Number(get("minute"));
    const toMin = (s: string) => { const [a, b] = s.split(":").map(Number); return a * 60 + (b || 0); };

    const isOpen = days.includes(dow) && nowMin >= toMin(open) && nowMin < toMin(close);
    if (isOpen) return null;

    const label = `${fmtHour(open)}–${fmtHour(close)} ${tzAbbr(tz)}, ${dayRange(days)}`;
    return `SUPPORT HOURS: The human team is currently OFFLINE (hours: ${label}). You STILL fully help the customer now using the knowledge base and tools. But if you raise a ticket or hand off, gently let them know the team is offline and will follow up when they're back (${label}) — one short line, don't over-apologise.`;
  } catch {
    return null;
  }
}
function fmtHour(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}
function tzAbbr(tz: string): string {
  return tz === "Asia/Kolkata" ? "IST" : tz;
}
function dayRange(days: number[]): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const key = [...new Set(days)].sort((a, b) => a - b).join(",");
  if (key === "1,2,3,4,5,6") return "Mon–Sat";
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "0,1,2,3,4,5,6") return "every day";
  return key.split(",").map((d) => names[Number(d)]).join(", ");
}

// OpenAI call with bounded retry on TRANSIENT failures (429 / 5xx / network).
// Safe to retry: every caller is BEFORE any customer send and before the
// per-turn claim, so a retry can never double-message. A transient blip used to
// throw → 500 → the customer waited for the next wa-jobs-tick (minutes); now we
// recover in-line. Non-transient errors (4xx other than 429) fail fast.
async function chatCreate(client: OpenAI, params: any, retries = 2): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await client.chat.completions.create(params);
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status && status !== 429 && status < 500) break; // not transient
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Mark the durable wa_jobs row done so wa-jobs-tick won't retry it.
// No-op for draft mode / dashboard calls, which carry no job_id.
async function markJobDone(jobId?: string | null) {
  if (!jobId) return;
  await db().from("wa_jobs").update({ status: "done", last_error: null })
    .eq("id", jobId).then(() => {}, () => {});
}

// ---- NO-SPAM per-turn reply claim -----------------------------------------
// Decide whether THIS run may send the reply for the current inbound turn.
//   - a newer customer message arrived  -> bow out; a later run answers the
//     fuller context (collapses a rapid-fire burst into ONE reply)
//   - another run / a wa-jobs-tick retry already owns this exact turn -> bow out
// Atomic via the claim_ai_reply RPC (mirrors claim_order_confirmation). If that
// RPC isn't deployed yet it degrades to a read-based check so the bot keeps
// working until the migration is applied.
async function claimReplyTurn(
  sb: any,
  threadId: string,
  inbound: { id: string; created_at: string } | undefined,
): Promise<{ send: boolean; reason?: string }> {
  if (!inbound) return { send: true }; // nothing to dedup against

  const { data: newer } = await sb
    .from("wa_messages").select("id")
    .eq("thread_id", threadId).eq("direction", "inbound")
    .gt("created_at", inbound.created_at).limit(1);
  if (newer && newer.length) return { send: false, reason: "superseded" };

  const { data: won, error } = await sb.rpc("claim_ai_reply", {
    p_thread: threadId,
    p_inbound: inbound.id,
  });
  if (!error) {
    return won === true ? { send: true } : { send: false, reason: "claimed_elsewhere" };
  }

  // RPC not deployed yet — best-effort read fallback (not fully atomic).
  const { data: replied } = await sb
    .from("wa_messages").select("id")
    .eq("thread_id", threadId).eq("direction", "outbound").eq("sent_by", "bot")
    .gt("created_at", inbound.created_at).limit(1);
  return replied && replied.length
    ? { send: false, reason: "already_replied" }
    : { send: true };
}

async function markReplyTurnSent(sb: any, threadId: string, inbound?: { id: string }) {
  if (!inbound) return;
  await sb.rpc("mark_ai_reply_sent", { p_thread: threadId, p_inbound: inbound.id })
    .then(() => {}, () => {});
}

async function releaseReplyTurn(sb: any, threadId: string, inbound?: { id: string }) {
  if (!inbound) return;
  await sb.rpc("release_ai_reply", { p_thread: threadId, p_inbound: inbound.id })
    .then(() => {}, () => {});
}

// Parse the model's final JSON decision — robustly. The model is told to emit
// JSON only, but in practice it wraps it in ```json fences or (most often) puts
// a literal newline inside the "reply" string, which is invalid JSON and used
// to make JSON.parse throw → a false "AI output unparseable" ticket on a reply
// that was actually fine. We try hard before giving up: strip fences, isolate
// the object, repair the common breakage, and as a last resort pull the reply
// text out directly so the customer is always answered.
function parseDecision(s: string): any {
  if (!s) return null;
  // strip ```json ... ``` / ``` ... ``` fences the model sometimes adds
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

// Repair almost-JSON: escape raw newlines/tabs that sit INSIDE a string literal
// (the model's #1 mistake — multi-line replies), then drop trailing commas.
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

// Last resort: pull just the "reply" out of broken output so we never go silent
// and never raise a spurious "unparseable" ticket when a real reply was present.
function looseReply(s: string): any {
  const m = s.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  const reply = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return { reply, handoff: /"handoff"\s*:\s*true/.test(s), ticket: null };
}

interface TicketInput {
  category?: string;
  priority?: string;
  reason?: string;
  order_number?: string;
}

// Map a structured order-change request (request_order_change tool) into a
// ticket the ops team acts on. Cancels + address fixes must beat dispatch →
// urgent; returns / replacements → high.
function changeToTicket(c: { changeType: string; orderNumber: string | null; details: string }): TicketInput {
  const label: Record<string, string> = {
    cancel: "Order cancellation",
    return: "Return / refund",
    replacement: "Replacement",
    address_change: "Delivery address change",
  };
  const category: Record<string, string> = {
    cancel: "order_issue",
    return: "refund",
    replacement: "order_issue",
    address_change: "order_issue",
  };
  const urgent = c.changeType === "cancel" || c.changeType === "address_change";
  return {
    category: category[c.changeType] ?? "order_issue",
    priority: urgent ? "urgent" : "high",
    reason: `${label[c.changeType] ?? "Order change"} requested — ${c.details}`,
    order_number: c.orderNumber ?? undefined,
  };
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

// Ping the ops "guard" on WhatsApp the instant a customer explicitly cancels, so
// the order can be pulled before dispatch. Sends the approved `order_cancel_ops`
// UTILITY template to OPS_WA_ID. Gated on the env var — a no-op until ops set
// their number, so this can ship before the number/template approval land.
async function notifyOpsCancel(
  waId: string | null,
  change: { orderNumber: string | null; details: string },
) {
  const opsWaId = (Deno.env.get("OPS_WA_ID") ?? "").replace(/^\+/, "").replace(/\D/g, "");
  if (!opsWaId) return; // not configured yet
  const tpl = Deno.env.get("OPS_CANCEL_TEMPLATE") ?? "order_cancel_ops";

  // Pull verified order details so the alert carries real data, not the model's
  // recollection. Fall back gracefully when the order can't be matched.
  let order: OrderSummary | null = null;
  if (change.orderNumber) {
    const found = await lookupOrders(waId, change.orderNumber).catch(() => [] as OrderSummary[]);
    order = found[0] ?? null;
  }

  const vars = {
    "1": order?.order_number ?? change.orderNumber ?? "unknown",
    "2": order?.customer_name ?? "—",
    "3": waId ? `+${waId}` : "—",
    "4": (change.details || "Customer requested cancellation").slice(0, 250),
  };

  await callSend({
    to: opsWaId,
    kind: "template",
    sent_by: "ops_cancel_alert",
    template: { name: tpl, language: "en", vars },
  });
}

// Build product_list sections from the wa_catalog_items mirror. Groups in-stock
// items by category (Meta caps: 30 items / 10 sections), optionally filtered by
// a category/title keyword. Returns null when nothing matches.
async function buildCatalogSections(
  sb: any,
  category: string | null,
): Promise<{ sections: CatalogSection[]; count: number; titles: string } | null> {
  let q = sb.from("wa_catalog_items").select("retailer_id, title, category, sort").eq("in_stock", true);
  // strip PostgREST control chars so a free-text category can't break the or() filter
  const c = (category ?? "").replace(/[(),.*%]/g, " ").trim().slice(0, 40);
  if (c) q = q.or(`category.ilike.%${c}%,title.ilike.%${c}%`);
  const { data, error } = await q
    .order("category", { ascending: true })
    .order("sort", { ascending: true })
    .limit(MAX_CATALOG_ITEMS);
  if (error || !data || !data.length) return null;

  const groups = new Map<string, Array<{ product_retailer_id: string }>>();
  for (const row of data) {
    const key = ((row.category ?? "More").toString().trim() || "More").slice(0, 24);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ product_retailer_id: String(row.retailer_id) });
  }
  let sections: CatalogSection[] = [...groups.entries()].map(([title, product_items]) => ({ title, product_items }));
  // Collapse any sections beyond Meta's cap into a final "More" section.
  if (sections.length > MAX_CATALOG_SECTIONS) {
    const head = sections.slice(0, MAX_CATALOG_SECTIONS - 1);
    const tail = sections.slice(MAX_CATALOG_SECTIONS - 1).flatMap((s) => s.product_items);
    head.push({ title: "More", product_items: tail });
    sections = head;
  }
  const count = sections.reduce((n, s) => n + s.product_items.length, 0);
  const titles = data.map((r: any) => r.title).slice(0, 12).join(", ");
  return { sections, count, titles };
}

async function callSend(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
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

// Prompt fragment appended to the support reply when an in-window ask is due.
function askInstruction(due: DueAsk): string {
  const kind = due.journeyKey === "replenishment_reminder"
    ? "restock / reorder reminder"
    : "quick product-review request";
  return [
    `ELIGIBLE FOLLOW-UP (optional — you decide):`,
    `This customer is due for a ${kind}. IF — and ONLY IF — this conversation is a happy or neutral close ` +
      `(NOT a complaint, NOT an unresolved problem, NOT mid-troubleshooting, NOT an open ticket), weave a SHORT, ` +
      `PERSONALIZED ${kind} into your reply: greet them by first name and name the ACTUAL products they bought ` +
      `(call lookup_order if you haven't), and include this link exactly once: ${due.url}. One or two sentences, ` +
      `warm, never vague or generic — say e.g. "hope you're loving the soya crunchies", never "hope you enjoyed your order".`,
    `Set "included_ask": true in your JSON if you included it, or "included_ask": false if the mood was wrong and you left it out.`,
  ].join("\n");
}

// Standalone in-window ask (driven by wa-journey-tick). Claims the ask atomically,
// composes ONE personalized free-text message from the customer's real order, and
// sends it as a session message (no template, no marketing cap). A failed send or
// empty generation releases the claim so a later tick retries it.
async function handleProactiveAsk(
  sb: ReturnType<typeof db>,
  threadId: string,
  waId: string | null,
  ask: { run_id: string; journey_key: string; url?: string; name?: string },
): Promise<Response> {
  if (!(await claimAsk(sb, ask.run_id))) return j({ ok: true, skipped: "already claimed" });
  try {
    const orders = waId ? await lookupOrders(waId, null).catch(() => [] as OrderSummary[]) : [];
    const order = orders[0] ?? null;
    const first = firstNameOf(order?.customer_name, ask.name);
    const products = (order?.items ?? []).map((i) => i.name).filter(Boolean);
    const text = await composeProactiveMessage(ask.journey_key, first, products, ask.url ?? "");
    if (!text) throw new Error("empty generation");
    const res = await callSend({
      thread_id: threadId,
      kind: "text",
      text,
      sent_by: `journey:${ask.journey_key}`,
      ai_generated: true,
    });
    if (!res?.ok) throw new Error(res?.error ?? "send failed");
    return j({ ok: true, sent: true, journey: ask.journey_key });
  } catch (e) {
    await releaseAsk(sb, ask.run_id);
    return j({ ok: false, error: String(e) }, 502);
  }
}

async function composeProactiveMessage(
  journeyKey: string,
  firstName: string,
  products: string[],
  url: string,
): Promise<string> {
  const kind = journeyKey === "abandoned_checkout"
    ? "a friendly abandoned-cart recovery nudge"
    : journeyKey === "replenishment_reminder"
    ? "a gentle restock / reorder reminder"
    : "a quick request to leave a product review";
  const isCart = journeyKey === "abandoned_checkout";
  const sys =
    `You write short, warm WhatsApp messages for PROMUNCH ("Your Munchy Pal"), an Indian healthy-snack brand. ` +
    `India-English, friendly, never corporate. Output ONLY the message text — no preamble, no quotes, no JSON.`;
  const user = [
    `Write ${kind} as ONE WhatsApp message.`,
    `Customer first name: ${firstName}.`,
    isCart
      ? `They left snacks in their cart without checking out. Gently remind them their cart is waiting and nudge them to complete the order — warm, low-pressure, no guilt. Do NOT invent specific product names.`
      : products.length
      ? `They actually ordered: ${products.join(", ")}. Mention these specific products by name — do NOT be vague or generic.`
      : `You don't have their exact products — keep it warm and personal using their first name; do not invent product names.`,
    url
      ? (isCart ? `Include this checkout link exactly once: ${url}` : `Include this link exactly once: ${url}`)
      : `Do not include any link.`,
    `End with the tagline "Your Munchy Pal 💚".`,
    `Keep it to 1–3 short sentences.`,
  ].join("\n");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const resp = await chatCreate(client, {
    model: MODEL,
    max_tokens: 300,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  return (resp.choices?.[0]?.message?.content ?? "").trim();
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
