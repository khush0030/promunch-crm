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
import { requireInternal } from "../_shared/require-internal.ts";
import { lookupOrders, orderForAI } from "../_shared/orders.ts";
import { buildCtaUrl, stripEmDashes, type CatalogSection } from "../_shared/whatsapp.ts";
import {
  type DueAsk,
  claimAsk,
  findDueAsk,
  logAskDelivery,
  markAskDelivered,
  releaseAsk,
} from "../_shared/window-asks.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { CATALOG_ID, MAX_REPLY_CHARS, MAX_TOOL_TURNS, MODEL, OPENAI_API_KEY } from "./config.ts";
import { lookupProducts, pickCard, type ProductCard } from "./products.ts";
import { supportHoursLabel } from "./support-hours.ts";
import { SYSTEM_PROMPT, TOOLS } from "./prompt.ts";
import { retrieveKb } from "./kb.ts";
import { supportHoursNote } from "./support-hours.ts";
import { chatCreate, textOf } from "./openai-util.ts";
import { claimReplyTurn, markJobDone, markReplyTurnSent, releaseReplyTurn } from "./turn-claim.ts";
import { parseDecision } from "./parse.ts";
import { type TicketInput, changeToTicket, openTicket } from "./ticket.ts";
import { buildCatalogSections } from "./catalog.ts";
import { callSend, j } from "./send.ts";
import { askInstruction, handleProactiveAsk } from "./asks.ts";

interface InvokeBody {
  thread_id: string;
  last_message?: string;
  draft?: boolean;
  job_id?: string | null;
  image_url?: string | null;
  // Proactive in-window ask (driven by wa-journey-tick when the 24h service
  // window is open): generate ONE personalized free-text review/restock message.
  proactive_ask?: { run_id: string; journey_key: string; url?: string; name?: string };
  // Set by wa-webhook when the inbound turn is a "Report a problem" quick-reply
  // tap. The customer is opening a complaint, so no follow-up ask may ride
  // along with the reply — not even one the model would have judged neutral.
  suppress_ask?: boolean;
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    // An unhandled throw here used to surface as an opaque 500 with the job
    // left pending, so the customer just went silent. Log the real error and
    // return it (this endpoint is internal-only, gated by requireInternal).
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("[wa-ai-reply] unhandled", msg);
    return j({ ok: false, error: msg.slice(0, 1500) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const { thread_id, last_message, draft, job_id, image_url, proactive_ask, suppress_ask } =
    (await req.json()) as InvokeBody;
  if (!thread_id) return j({ error: "thread_id required" }, 400);

  const sb = db();

  // thread — wa_id is the customer's phone, used for order lookup
  const { data: thread } = await sb
    .from("wa_threads")
    .select("wa_id, ticket_status, ticket_category, ticket_number, escalation_reason")
    .eq("id", thread_id)
    .maybeSingle();
  const waId: string | null = thread?.wa_id ?? null;
  // Open-ticket awareness: the bot must not re-qualify a lead or re-collect
  // complaint details the team already has (audit 2.3: day-two loops).
  const openTicketNote = thread?.ticket_status === "open" || thread?.ticket_status === "pending"
    ? `OPEN TICKET on this chat: #${thread.ticket_number ?? "?"} (${thread.ticket_category ?? "general"}): ${
      String(thread.escalation_reason ?? "").slice(0, 240)
    }. The team already has these details and will call back (${supportHoursLabel()}). Do not re-ask for them. Only raise a NEW ticket if the customer brings up something different.`
    : "";

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
  // Product cards the model asked to send (image + Buy button). Delivered AFTER
  // the per-turn claim is won, so a retry can never double-send them. Capped at
  // two: this is a chat, not a catalogue dump.
  let knownCards: ProductCard[] = [];
  const pendingCards: ProductCard[] = [];
  // Structured order-change request from the request_order_change tool — becomes
  // THE ticket at the end (takes precedence over decision.ticket so we never
  // raise two escalations for the same turn).
  let pendingChange: { changeType: string; orderNumber: string | null; details: string } | null = null;
  // findDueAsk now also considers abandoned_checkout (the highest-value ask we
  // have): a customer with a live cart who just messaged us has an OPEN window,
  // and the free-text path delivers at ~99% where the cart's marketing template
  // is 84% blocked. It returns at most ONE ask, priority cart > review > restock,
  // and never a cart run without its checkout link.
  if (!draft && waId && !suppress_ask) {
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
    openTicketNote ? "\n" + openTicketNote : "",
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
      } else if (call.function?.name === "lookup_product") {
        let arg: { query?: string; in_stock_only?: boolean } = {};
        try { arg = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
        const found = await lookupProducts(sb, String(arg.query ?? ""), arg.in_stock_only !== false)
          .catch((e) => {
            console.error("[wa-ai-reply] lookup_product failed", e);
            return { text: "Product lookup failed. Tell the customer the team will send the link shortly.", cards: [] as ProductCard[] };
          });
        knownCards = [...knownCards, ...found.cards];
        result = found.text;
      } else if (call.function?.name === "send_product_card") {
        let arg: { product_title?: string } = {};
        try { arg = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
        const card = pickCard(knownCards, String(arg.product_title ?? ""));
        if (!card) {
          result = "No such product in the lookup results. Call lookup_product first, then use a product title exactly as it appeared there.";
        } else if (pendingCards.length >= 2) {
          result = "Two cards are already queued, that is the limit for one reply. Do not send more.";
        } else if (pendingCards.some((c) => c.url === card.url)) {
          result = "That card is already queued for this reply.";
        } else {
          pendingCards.push(card);
          result = `Queued a product card for ${card.title}. It goes out right after your reply as a photo with a Buy button. Do NOT repeat the name, price or URL in your reply text, just say one short line like "Here you go" or a sentence about why it suits them.`;
        }
      } else if (call.function?.name === "show_products") {
        let arg: { category?: string } = {};
        try { arg = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
        if (!CATALOG_ID) {
          result = "The in-chat product cards aren't available right now. Do NOT mention this to the customer and NEVER say ordering is 'coming soon' or unavailable. Instead, warmly help them using the knowledge base: describe PROMUNCH's products, flavours and what makes them great, answer their question, and point them to the website to order. Act like a normal, helpful brand assistant.";
        } else {
          const cat = await buildCatalogSections(sb, arg.category ?? null).catch((e) => {
            console.error("[wa-ai-reply] show_products failed", e);
            return null;
          });
          if (!cat || cat.count === 0) {
            result = (arg.category && arg.category.trim())
              ? `No products matched '${arg.category}'. Offer to show the full menu instead (call show_products with no category).`
              : "The in-chat product cards aren't available right now. Do NOT mention this or say ordering is unavailable. Help the customer using the knowledge base — describe PROMUNCH's products and flavours, answer their question, and point them to the website to order.";
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
    // tools MUST still be passed: OpenAI rejects tool_choice without them
    // ("'tool_choice' is only allowed when 'tools' are specified"), which threw
    // a 400 and left the customer with no reply at all.
    resp = await chatCreate(client, {
      model: MODEL,
      max_tokens: 900,
      tools: TOOLS,
      tool_choice: "none",
      messages,
    });
    lastUsage = resp.usage;
  }

  let decision = parseDecision(textOf(resp));

  // Empty / unparseable reply: one explicit retry before the canned fallback.
  // The audit found the fallback fired three times on a food-safety complaint,
  // including as the answer to "Proceed with refund" (thread 4a2dd47c).
  if (!decision?.reply?.trim()) {
    console.error("[wa-ai-reply] empty reply, retrying once", { thread_id, raw: textOf(resp)?.slice(0, 400) });
    messages.push({
      role: "user",
      content: "Your last output had no usable reply. Write the customer reply now: JSON only, 1 to 3 short sentences in \"reply\", plus handoff and ticket.",
    });
    resp = await chatCreate(client, { model: MODEL, max_tokens: 600, tools: TOOLS, tool_choice: "none", messages });
    lastUsage = resp.usage;
    decision = parseDecision(textOf(resp)) ?? decision;
  }

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
  const voice = await getFlowSettings();
  const TAGLINE = (voice.tagline_text || "").trim();
  let replyText = (decision?.reply?.trim() ||
    "Got it, I've passed this to the team and they'll get back to you shortly.")
    // The model must never sign off itself. Strip any tagline it produced,
    // wherever it put it, plus the green heart that rode along with it.
    .replace(/[\s,.!-]*(?:[—–-]\s*)?your munchy pal\s*💚?\s*[.!]?/gi, "")
    .replace(/\s*💚\s*$/g, "")
    .trim();
  if (TAGLINE && replyText.toLowerCase().endsWith(TAGLINE.toLowerCase())) {
    replyText = replyText.slice(0, replyText.length - TAGLINE.length).replace(/[\s—–-]+$/g, "").trim();
  }
  replyText = stripEmDashes(replyText);

  // Belt and braces on the "never paste a link" rule: a raw product URL in the
  // reply text is unreadable on WhatsApp (it wraps over ten lines) and is what
  // the product card exists to replace. Strip product links only, order status
  // and checkout links are legitimately sent as text elsewhere.
  replyText = replyText
    .replace(/\s*(?:here|below)?\s*:?\s*https?:\/\/[^\s]*\/products\/[^\s]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.!?,])/g, "$1")
    .replace(/[\s,]+$/g, "")
    .trim();
  if (!replyText) replyText = pendingCards.length ? "Here you go." : "Let me check that and get back to you.";

  // Brevity guard: one deterministic shorten pass when the model overshoots.
  if (replyText.length > MAX_REPLY_CHARS && !/https?:\/\//.test(replyText)) {
    try {
      const short = await chatCreate(client, {
        model: MODEL,
        max_tokens: 200,
        messages: [
          { role: "system", content: "Rewrite this WhatsApp reply so it reads like a person texting: at most 2 short sentences, keep every fact, number and link exactly, no greeting, no sign-off, no em dashes. Output the rewritten text only." },
          { role: "user", content: replyText },
        ],
      });
      const t = stripEmDashes((textOf(short) ?? "").trim());
      if (t && t.length < replyText.length) replyText = t;
    } catch (e) {
      console.error("[wa-ai-reply] shorten pass failed", e);
    }
  }

  // Safety backstop (audit 2.5): a food-safety or legal message must hand off
  // and raise an urgent complaint even if the model forgot.
  const SAFETY = /\b(insect|fly|flies|worm|maggot|hair|fungus|mould|mold|foreign object|food poison|vomit|sick after|hospital|allergic reaction|consumer court|legal action|lawyer|fssai)\b/i;
  if (decision && SAFETY.test(latest ?? "")) {
    decision.handoff = true;
    if (!decision.ticket || !/urgent/i.test(String(decision.ticket.priority ?? ""))) {
      decision.ticket = {
        category: "complaint",
        priority: "urgent",
        reason: (decision.ticket?.reason as string) || `Food safety / legal complaint: ${String(latest).slice(0, 200)}`,
        order_number: decision.ticket?.order_number,
      };
    }
  }

  const priorBotReply = ordered.some((m) => m.direction === "outbound" && m.sent_by === "bot");
  const isOpening = !priorBotReply;
  const isClosing = /\b(thanks|thank you|thank u|thx|tysm|bye|goodbye|see you|that'?s all|that'?s it|nothing else|all good|no that'?s all|cheers)\b/i.test(latest ?? "");
  // Tagline only when the Flows-tab toggle is explicitly ON (off since Sep 2026).
  if ((isOpening || isClosing) && voice.tagline_bot_replies === true && TAGLINE) replyText = `${replyText}\n\n${TAGLINE}`;

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

  // From here on we HOLD the per-turn claim. Any throw past this point used to
  // leave the claim held forever, so wa-jobs-tick could never retry and the
  // customer just went silent (that is what "the bot got stuck" looks like).
  // Release the claim on an unexpected failure, then rethrow.
  try {
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
    // The woven ask went out INSIDE that reply, so a failed reply means the ask
    // was not delivered either — hand its claim back too, or a due cart/review
    // would be marked completed having reached nobody. Releasing only on a
    // CONFIRMED non-send keeps this from ever becoming a second delivery.
    await releaseReplyTurn(sb, thread_id, answerInbound);
    if (claimedAsk) { await releaseAsk(sb, claimedAsk.runId); claimedAsk = null; }
    return j({ ok: false, error: sent.error ?? "send failed" }, 502);
  }
  await markReplyTurnSent(sb, thread_id, answerInbound);

  // The reply (ask included) is confirmed away. Stamp the ask's terminal
  // delivered flag and count it: this is an ask that reached the customer as
  // cap-immune free text on the back of an inbound message, instead of burning
  // an 84%-blocked marketing template attempt.
  if (claimedAsk) {
    await markAskDelivered(sb, claimedAsk.runId);
    await logAskDelivery({
      journeyKey: claimedAsk.journeyKey,
      mode: "free_text",
      path: "inbound_weave",
      runId: claimedAsk.runId,
      waId,
      orderRef: claimedAsk.orderRef,
    });
  }

  // Product cards: photo + one-line caption + a Buy button, sent after the text
  // reply and gated by the per-turn claim so a retry cannot double-send them.
  for (const card of pendingCards) {
    const price = card.price != null
      ? `Rs ${Number.isInteger(card.price) ? card.price : card.price.toFixed(2)}`
      : "";
    const caption = price ? `${card.title}\n${price}` : card.title;
    await callSend({
      thread_id: thread_id,
      kind: "interactive",
      sent_by: "bot",
      interactive: buildCtaUrl(caption, "Buy now", card.url, undefined, card.image ?? undefined),
    }).catch((e) => console.error("[wa-ai-reply] product card send failed", e));
  }

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
  // openTicket() fires the WhatsApp ops ping (order lane → OPS_WA_ID/Narendra,
  // everything else → owner) on a fresh ticket — including explicit cancels,
  // which map to an urgent order_issue ticket. No separate cancel ping needed.
  if (handoff || ticket) await openTicket(thread_id, waId, ticket, handoff);

  await markJobDone(job_id);
  return j({ ok: true, action: handoff ? "handoff" : "reply", ticket: !!ticket });
  } catch (e) {
    await releaseReplyTurn(sb, thread_id, answerInbound).catch(() => {});
    if (claimedAsk) await releaseAsk(sb, claimedAsk.runId).catch(() => {});
    throw e;
  }
}
