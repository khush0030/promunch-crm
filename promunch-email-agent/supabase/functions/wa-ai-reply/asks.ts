// In-window proactive asks (review / restock / cart nudges).
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { type DueAsk, claimAsk, releaseAsk, firstNameOf } from "../_shared/window-asks.ts";
import { lookupOrders, type OrderSummary } from "../_shared/orders.ts";
import { MODEL, OPENAI_API_KEY } from "./config.ts";
import { chatCreate } from "./openai-util.ts";
import { callSend, j } from "./send.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";

// Prompt fragment appended to the support reply when an in-window ask is due.
export function askInstruction(due: DueAsk): string {
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
export async function handleProactiveAsk(
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
  // Brand sign-off is Flows-tab config (brand voice card) — surface toggle
  // plus editable text. Empty/off means no tagline on proactive nudges.
  const askFlows = await getFlowSettings();
  const askTagline = askFlows.tagline_proactive_asks ? (askFlows.tagline_text || "").trim() : "";
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
    askTagline
      ? `End with the tagline "${askTagline}".`
      : `Do not add any sign-off or tagline.`,
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
