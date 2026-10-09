// Review feedback ask (owner-approved Oct 9 2026). PURE helpers only, no I/O.
//
// Instead of the plain review_request ask, the review journey can send a
// three-button "how are you liking your box?" check-in. Each tap gets ONE
// deterministic reply:
//   Loved it  -> review link
//   It's okay -> "what would make it a 😍?" + review link
//   Not happy -> apology + review link, AND an urgent support ticket + an ORM
//                complaint case (see review-feedback-flow.ts).
//
// Gated by wa_flow_settings.review_feedback_enabled (default false). With the
// flag off nothing here is reachable from a send path and the journey behaves
// exactly as before.
//
// Button payloads carry the choice and a stable reference (the review_request
// journey run id), e.g. "rvf:loved:6f1c...". The ref is what the never-twice
// claim (wa_review_feedback unique (wa_id, ref)) keys on.

import type { TemplateComponent } from "./whatsapp.ts";

export const REVIEW_FEEDBACK_TEMPLATE = "review_feedback_v1";
export const REVIEW_FEEDBACK_LANGUAGE = "en";
export const REVIEW_FEEDBACK_FOOTER = "Your Munchy Pal";

export type FeedbackChoice = "loved" | "okay" | "unhappy";
export const FEEDBACK_CHOICES: readonly FeedbackChoice[] = ["loved", "okay", "unhappy"];

// Session (in-window) interactive buttons carry the approved emoji labels.
// Reply-button titles are capped at 20 chars by Meta; these are well under.
export const FEEDBACK_BUTTON_TITLES: Record<FeedbackChoice, string> = {
  loved: "😍 Loved it",
  okay: "🙂 It's okay",
  unhappy: "😕 Not happy",
};

// Template quick-reply labels. Our template validator (template-rules.ts)
// records that Meta rejects emojis in template button labels, so the TEMPLATE
// labels are the same words without the emoji. Routing never depends on the
// label: the payload carries the choice.
export const FEEDBACK_TEMPLATE_BUTTON_LABELS: Record<FeedbackChoice, string> = {
  loved: "Loved it",
  okay: "It's okay",
  unhappy: "Not happy",
};

const PAYLOAD_PREFIX = "rvf:";
// ref: a journey run uuid today; an order ref ("2083" / "#2083") is also legal.
const PAYLOAD_RE = /^rvf:(loved|okay|unhappy):([A-Za-z0-9#_-]{1,80})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildFeedbackPayload(choice: FeedbackChoice, ref: string): string {
  return `${PAYLOAD_PREFIX}${choice}:${ref}`;
}

// Any payload in our namespace, well-formed or not. wa-webhook uses this to
// swallow a malformed "rvf:" tap (log, no reply) instead of letting it fall
// through to the AI bot.
export function isFeedbackPayload(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().toLowerCase().startsWith(PAYLOAD_PREFIX);
}

export function parseFeedbackPayload(
  raw: unknown,
): { choice: FeedbackChoice; ref: string } | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(PAYLOAD_RE);
  if (!m) return null;
  return { choice: m[1] as FeedbackChoice, ref: m[2] };
}

export function isRunRef(ref: string): boolean {
  return UUID_RE.test(ref);
}

function cleanName(name: string | null | undefined): string {
  const t = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return t || "there";
}

// Approved ask body. In the template this is "Hi {{1}}, it's PROMUNCH! 👋 How
// are you liking your box?"; the in-window version fills the name directly.
export const FEEDBACK_TEMPLATE_BODY = "Hi {{1}}, it's PROMUNCH! 👋 How are you liking your box?";

export function feedbackAskBody(name: string | null | undefined): string {
  return FEEDBACK_TEMPLATE_BODY.replace("{{1}}", cleanName(name));
}

// Flat vars stored on the wa_messages ledger row (wa-send renders the body
// from these): {"1": first name}.
export function feedbackTemplateVars(name: string | null | undefined): Record<string, string> {
  return { "1": cleanName(name) };
}

// Template send components: body {{1}} = first name, then one quick-reply
// payload per button (index order MUST match the approved template's order).
export function buildFeedbackTemplateComponents(
  name: string | null | undefined,
  ref: string,
): TemplateComponent[] {
  return [
    { type: "body", parameters: [{ type: "text", text: cleanName(name) }] },
    ...FEEDBACK_CHOICES.map((choice, i) => ({
      type: "button",
      sub_type: "quick_reply",
      index: String(i),
      parameters: [{ type: "payload", payload: buildFeedbackPayload(choice, ref) }],
    } as TemplateComponent)),
  ];
}

// In-window (24h session open) equivalent: an interactive button message with
// the same body, footer and the emoji labels.
export function buildFeedbackInteractive(
  name: string | null | undefined,
  ref: string,
): Record<string, unknown> {
  return {
    type: "button",
    body: { text: feedbackAskBody(name) },
    footer: { text: REVIEW_FEEDBACK_FOOTER },
    action: {
      buttons: FEEDBACK_CHOICES.map((choice) => ({
        type: "reply",
        reply: { id: buildFeedbackPayload(choice, ref), title: FEEDBACK_BUTTON_TITLES[choice] },
      })),
    },
  };
}

// The approved replies, verbatim. No em dashes.
export function feedbackReplyText(choice: FeedbackChoice, reviewUrl: string): string {
  switch (choice) {
    case "loved":
      return `Yay, that made our day! 💚 Could you share it in a quick review? It takes 30 seconds and really helps a small Indian brand: ${reviewUrl}`;
    case "okay":
      return `Thanks for being honest! What would make it a 😍 for you: taste, crunch, price, or something else? Just reply here, a real person reads every message.\n\nIf you'd like to leave a review, here's the link: ${reviewUrl}`;
    case "unhappy":
      return `So sorry about that. 😕 Please tell us what went wrong, and add a photo if you can. Our team will sort it out within 24 hours.\n\nYou're always welcome to leave a review too: ${reviewUrl}`;
  }
}

// wa_messages.sent_by ledger marker for a tap reply. One per (ask, customer):
// the ref is the journey run, which already belongs to exactly one wa_id.
export function feedbackReplyMarker(ref: string): string {
  return `review_feedback:${ref}`;
}

// Is the feature live for this customer? Flag off -> never. Flag on with an
// allowlist (REVIEW_FEEDBACK_ONLY_WA_IDS, comma separated) -> only those
// numbers, for a staged go-live on the owner's phone. Flag on, no allowlist ->
// everyone.
export function reviewFeedbackActiveFor(
  flagEnabled: boolean,
  waId: string | null | undefined,
  allowlistRaw: string | null | undefined,
): boolean {
  if (!flagEnabled) return false;
  const allow = String(allowlistRaw ?? "")
    .split(/[,;\s]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean);
  if (!allow.length) return true;
  const id = String(waId ?? "").replace(/\D/g, "");
  return !!id && allow.includes(id);
}

// Which template the review journey's TEMPLATE path should send, given the
// flag and whether review_feedback_v1 is approved at Meta. Flag on but not
// approved -> keep the legacy review_request template (never stall the ask).
export function reviewTemplateChoice(
  active: boolean,
  feedbackTemplateApproved: boolean,
): "feedback" | "legacy" {
  return active && feedbackTemplateApproved ? "feedback" : "legacy";
}

export type TapRunVerdict = "ok" | "unknown_ref" | "wrong_customer" | "wrong_journey";

// Validate the journey run a tap points at before anything is claimed or sent.
export function classifyTapRun(
  run: { wa_id?: string | null; journey_key?: string | null } | null | undefined,
  waId: string,
): TapRunVerdict {
  if (!run) return "unknown_ref";
  if (run.journey_key !== "review_request") return "wrong_journey";
  const a = String(run.wa_id ?? "").replace(/\D/g, "");
  const b = String(waId ?? "").replace(/\D/g, "");
  if (!a || a !== b) return "wrong_customer";
  return "ok";
}

// Insert-first claim verdict. Only a clean insert wins. 23505 = this ask was
// already answered (a second tap): log, no reply. ANY other error: in doubt,
// send nothing.
export function claimVerdict(
  error: { code?: string | null } | null | undefined,
): "won" | "duplicate" | "error" {
  if (!error) return "won";
  return error.code === "23505" ? "duplicate" : "error";
}

// orm_mentions row for a "Not happy" tap: a high-urgency complaint with an
// open case. Already enriched (enriched_at set) so orm-tick never re-enriches
// it. external_id = the tap's wamid, so (source, external_id) is unique per tap.
export function buildNotHappyMention(o: {
  tapWamid: string;
  waId: string;
  name: string | null;
  orderRef: string | null;
  runId: string | null;
  contactId: string | null;
  nowIso: string;
}): Record<string, unknown> {
  return {
    source: "whatsapp",
    external_id: o.tapWamid,
    url: null,
    author_name: o.name || null,
    author_handle: `+${o.waId}`,
    title: "Review ask: Not happy",
    body: "Customer tapped Not happy on the review ask",
    rating: null,
    posted_at: o.nowIso,
    is_owned: true,
    raw: { wa_id: o.waId, order_ref: o.orderRef, journey_run_id: o.runId, choice: "unhappy" },
    enriched_at: o.nowIso,
    relevant: true,
    sentiment: -2,
    intent: "complaint",
    urgency: "high",
    summary: `Customer tapped Not happy on the WhatsApp review ask${o.orderRef ? ` for order ${o.orderRef}` : ""}.`,
    order_ref: o.orderRef,
    ...(o.contactId ? { contact_id: o.contactId } : {}),
    case_status: "open",
    case_opened_at: o.nowIso,
  };
}
