// Pure prompt builder + brand-rule cleanup for AI reply drafts
// (POST /api/orm/mentions/[id]/draft). Unit-tested. Drafts are only ever
// shown to a teammate, who edits, copies and posts them by hand (v1).
import type { OrmMention, OrmSourceKey } from "./types";

export const REPLY_MAX_CHARS = 400;
export const REPLY_MODEL = process.env.ORM_REPLY_MODEL || "gpt-4.1";
const KB_BUDGET = 9000;

const TONE: Record<OrmSourceKey, string> = {
  judgeme: "a reply under a review on our own website: warm, short, personal",
  amazon: "a public seller reply to an Amazon review: polite, factual, short",
  youtube: "a YouTube comment reply: friendly and casual, like a real person",
  reddit: "a Reddit comment: plain, honest, conversational, zero marketing speak, no hashtags or emojis",
  rss: "a short, polite note to the writer of a news or blog article",
  instagram: "an Instagram comment reply: friendly and short",
  whatsapp: "a private WhatsApp note to a customer who said they are not happy with their order: warm, short, ask what went wrong",
  competitors: "a short public reply",
};

export const REPLY_SYSTEM_PROMPT = `You write public replies for PROMUNCH, an Indian high-protein snack brand ("Your Munchy Pal").
A teammate will read, edit and post your reply by hand.

Rules (all must hold):
- Write the brand name as PROMUNCH, always in capitals.
- Never use em dashes or en dashes. Use commas or full stops.
- Only state product facts that appear in the KNOWLEDGE BASE. If a fact is not there, do not guess.
- No medical or health claims (no "cures", "treats", "good for diabetes", weight-loss promises).
- Never argue, blame the customer, or get defensive.
- For a complaint or a problem: say sorry plainly, and ask them to message us privately (DM) or email hello@promunch.in so the team can fix it. Use a WhatsApp number only if it appears in the knowledge base.
- Never ask for or repeat order numbers, phone numbers, addresses or other personal details in public.
- For praise: thank them warmly and briefly. For a question: answer it from the knowledge base.
- At most ${REPLY_MAX_CHARS} characters. Plain text only, no quotes around the reply, no sign-off line with a name.
- Reply in the same language as the post (Hinglish is fine if they wrote Hinglish).`;

export type ReplyInput = Pick<
  OrmMention,
  "source" | "author_name" | "author_handle" | "title" | "body" | "rating" | "summary" | "intent" | "product" | "is_owned"
>;

export function buildReplyUserPrompt(m: ReplyInput, kb: string): string {
  const who = m.author_name || m.author_handle || "someone";
  const lines = [
    `PLATFORM: ${TONE[m.source] ?? "a short public reply"}.`,
    `AUTHOR: ${who}`,
    m.rating != null ? `RATING: ${m.rating} out of 5 stars` : null,
    m.intent ? `TYPE: ${m.intent}` : null,
    m.product ? `PRODUCT: ${m.product}` : null,
    m.title ? `TITLE: ${m.title.slice(0, 300)}` : null,
    `TEXT:\n${(m.body || "").slice(0, 2000)}`,
    "",
    "KNOWLEDGE BASE (the only source of product facts):",
    (kb || "(empty)").slice(0, KB_BUDGET),
    "",
    "Write the reply now.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/**
 * Brand rules in code (the model is told, this makes sure):
 *  - PROMUNCH in capitals (not inside emails / domains like hello@promunch.in)
 *  - em/en dashes become commas (number ranges become "to")
 *  - wrapping quotes stripped, whitespace tidied, capped at REPLY_MAX_CHARS
 */
export function cleanReply(raw: string): string {
  return capLength(applyBrandRules(raw), REPLY_MAX_CHARS);
}

/** cleanReply without the length cap (used for teammate-edited replies). */
export function applyBrandRules(raw: string): string {
  let t = (raw ?? "").trim();
  // wrapping quotes the model sometimes adds
  t = t.replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "").trim();
  // number ranges: 3–5 days -> 3 to 5 days
  t = t.replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2");
  // every other em/en dash (and a spaced hyphen used as a dash) -> comma
  t = t.replace(/\s*[—–]+\s*/g, ", ").replace(/\s+-{1,2}\s+/g, ", ");
  // brand name, but never inside an email address, URL or domain
  t = t.replace(/(?<![@./\w])pro[ -]?munch(?![\w@]|\.[a-z])/gi, "PROMUNCH");
  // tidy punctuation the replacements can leave behind
  t = t
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,([.!?])/g, "$1")
    .replace(/^,\s*/, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}

/** Cut at the last sentence end (or word) that fits. */
export function capLength(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1).trim();
  const lastDot = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (lastDot === cut.length - 1) return cut.trim();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[,;:]$/, "").trim() + ".";
}
