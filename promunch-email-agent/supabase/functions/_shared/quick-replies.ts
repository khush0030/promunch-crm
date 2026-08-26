// Service quick-reply buttons on the high-delivery UTILITY templates.
//
// WHY THIS EXISTS (the window-manufacturing bridge):
//   Marketing templates are 84% blocked per-recipient by Meta (#131049).
//   Utility templates are 1.7% blocked. Free-form text inside an open 24h
//   customer-service window is 1% blocked, free, and can say anything.
//   The catch: a window only opens when the CUSTOMER messages us first, and
//   only 82 of 1,413 contacts ever have.
//
//   A quick-reply tap IS an inbound message. So putting genuinely useful
//   service buttons on the templates that already reach ~99% of customers
//   (order confirmation, shipping update) gives them a one-tap way to do the
//   thing they already wanted to do, and opens the 24h window as a side effect
//   of being useful. That is entirely within Meta policy: these are service
//   intents, not engagement bait, and they keep the template UTILITY.
//
// META RULES honoured here (verified against developers.facebook.com, Aug 2026):
//   - a template may carry up to 10 buttons / 10 quick replies; we use 3, which
//     is what WhatsApp renders inline before collapsing into a list.
//   - button label text is 25 characters maximum.
//   - quick replies must be grouped together (we send only quick replies).
//   - UTILITY templates may carry quick-reply buttons. The CATEGORY is decided
//     by CONTENT, so every label below is a service intent ("track", "change my
//     address", "report a problem") and none is a purchase CTA — a "Shop again"
//     or "See offers" button would get the template recategorised as MARKETING
//     and drop it straight back into the 84%-blocked bucket. Do not add one.
//
// PAYLOADS: we send an explicit quick_reply button component per button rather
// than relying on Meta's implicit "payload defaults to the label" behaviour.
//   1. It removes any chance of a #132012 component mismatch on the order
//      confirmation, which is the business's lifeline at 99% delivery.
//   2. It carries the ORDER REF back to us on the tap, so the reply can be
//      about the right order instead of guessing.

import type { TemplateComponent } from "./whatsapp.ts";
import { logConnector } from "./connector-log.ts";

export type SupportIntent = "track" | "address" | "question" | "problem";

interface IntentDef {
  code: string;   // payload code, uppercase, no underscores
  label: string;  // button text, <= 25 chars, no em dashes
}

// Button labels. Keep every one of these a SERVICE intent (see category note
// above) and at or under 25 characters.
const INTENTS: Record<SupportIntent, IntentDef> = {
  track:    { code: "TRACK", label: "Track my order" },
  address:  { code: "ADDR",  label: "Change my address" },
  question: { code: "ASK",   label: "I have a question" },
  problem:  { code: "ISSUE", label: "Report a problem" },
};

// Which template carries which buttons, in button order.
//
// Order confirmation (pre-ship): tracking, and the two things that are only
// fixable BEFORE dispatch — a wrong address and an open question.
// Shipping update (post-ship): tracking, a question, and "report a problem",
// which is the real need once a parcel is moving (late / damaged / wrong item).
export const TEMPLATE_QUICK_REPLIES: Record<string, SupportIntent[]> = {
  order_confirmation_v3: ["track", "address", "question"],
  order_confirmation_repeat_v2: ["track", "address", "question"],
  shipping_update_v2: ["track", "question", "problem"],
};

export function quickRepliesFor(templateName: string | null | undefined): SupportIntent[] {
  return TEMPLATE_QUICK_REPLIES[String(templateName ?? "")] ?? [];
}

export function intentLabel(intent: SupportIntent): string {
  return INTENTS[intent].label;
}

// Meta caps quick-reply payloads well above this; we keep refs short and
// character-safe so a payload can never be the reason a send fails.
function safeRef(orderRef: string | null | undefined): string {
  return String(orderRef ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 48);
}

export function buildSupportPayload(intent: SupportIntent, orderRef: string | null | undefined): string {
  const ref = safeRef(orderRef);
  return ref ? `HELP_${INTENTS[intent].code}_${ref}` : `HELP_${INTENTS[intent].code}`;
}

const PAYLOAD_RE = /^HELP_([A-Z]+)(?:_([A-Za-z0-9-]{1,48}))?$/;
const BY_CODE: Record<string, SupportIntent> = Object.fromEntries(
  (Object.keys(INTENTS) as SupportIntent[]).map((k) => [INTENTS[k].code, k]),
);

// Read a tap back. Returns null for anything that is not one of our service
// buttons, so the COD gate's CONFIRM_/CANCEL_ payloads and every dashboard-made
// button fall through to their own handlers untouched.
export function parseSupportPayload(
  payload: string | null | undefined,
): { intent: SupportIntent; orderRef: string | null } | null {
  const m = String(payload ?? "").match(PAYLOAD_RE);
  if (!m) return null;
  const intent = BY_CODE[m[1]];
  if (!intent) return null;
  return { intent, orderRef: m[2] ? `#${m[2].replace(/^#/, "")}` : null };
}

// The full component array for a buttoned utility template: body params in
// numeric var order, then one quick_reply component per button at its index.
// Returns null when the template carries no service buttons, so the caller
// keeps wa-send's default body-only component build (never send a button
// component for a template that has no buttons — that is a #132012).
export function buildSupportComponents(
  templateName: string,
  vars: Record<string, string>,
  orderRef: string | null | undefined,
): TemplateComponent[] | null {
  const intents = quickRepliesFor(templateName);
  if (!intents.length) return null;
  const sorted = Object.entries(vars).sort(([a], [b]) => Number(a) - Number(b));
  const comps: TemplateComponent[] = [
    { type: "body", parameters: sorted.map(([, v]) => ({ type: "text" as const, text: v })) },
  ];
  intents.forEach((intent, i) => {
    comps.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(i),
      parameters: [{ type: "payload", payload: buildSupportPayload(intent, orderRef) }],
    });
  });
  return comps;
}

// What the AI is told when a service button is tapped. The tap carries the
// customer's INTENT, not their words, so we hand the model a bracketed system
// note (see SYSTEM_PROMPT "QUICK REPLY TAPS") rather than pretending they typed
// the label. Every branch still answers from the Master KB / real order data —
// none of these instructions invite the model to invent anything.
export function supportTapPrompt(
  intent: SupportIntent,
  orderRef: string | null,
): string {
  const about = orderRef ? ` about order ${orderRef}` : "";
  const head = `[System note: the customer tapped the "${INTENTS[intent].label}" quick reply button on our WhatsApp message${about}. They did not type anything. Treat the tap as their request.]`;
  const how: Record<SupportIntent, string> = {
    track:
      "Call lookup_order now" + (orderRef ? ` for order ${orderRef}` : "") +
      ", then tell them the real current status of that order and give them the order status link from the lookup. One short warm message. Never invent a status, a date or a courier.",
    address:
      "They want the delivery address on that order changed. Ask them to send the FULL corrected address in one message. Once they have sent it, call request_order_change with change_type 'address_change'. Do not claim the address is already changed.",
    question:
      "They want to ask us something. Reply with one short warm line inviting them to tell you what they need. Do not guess what the question is and do not raise a ticket yet.",
    problem:
      "Something is wrong with that order. Call lookup_order, then ask them briefly what happened (late, damaged, missing or wrong item) and tell them the team will sort it. Raise an order_issue ticket only once you know what actually went wrong. Never describe a problem they have not stated.",
  };
  return `${head}\n${how[intent]}`;
}

// ---- measurement --------------------------------------------------------
// "Windows opened by button tap" is THE number this whole design exists to
// grow, so every tap emits one connector_event. `was_open` separates a tap
// that genuinely OPENED a window from one that merely refreshed a window the
// customer already had open:
//
//   select detail->>'intent', detail->>'was_open', count(*)
//   from connector_events
//   where connector = 'whatsapp' and event = 'window_opened_by_button'
//   group by 1, 2;
export function logWindowOpenedByTap(input: {
  waId: string;
  threadId: string;
  buttonText: string;
  payload: string | null;
  intent: SupportIntent | null;
  orderRef: string | null;
  wasOpen: boolean;
}): Promise<void> {
  return logConnector({
    connector: "whatsapp",
    level: "info",
    event: "window_opened_by_button",
    message: input.wasOpen
      ? `Quick-reply tap "${input.buttonText}" from ${input.waId} refreshed an already-open 24h window.`
      : `Quick-reply tap "${input.buttonText}" from ${input.waId} OPENED a 24h service window.`,
    detail: {
      wa_id: input.waId,
      thread_id: input.threadId,
      button_text: input.buttonText,
      payload: input.payload,
      intent: input.intent,
      // true  = window was already open, this tap only extended it
      // false = this tap is what made free-form delivery possible
      was_open: input.wasOpen,
    },
    ref: input.orderRef,
  }).catch(() => {});
}
