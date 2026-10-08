// Pure prompt builder for AI influencer briefs. The route loads the deal, the
// creator, the kit and the Master KB, and this turns them into the OpenAI
// messages + JSON schema. Kept pure so the copy rules are unit-testable.

import { PROMUNCH_IG_HANDLE, deliverablesLine } from "./brief-content";
import type { Deliverables, UsageRights } from "./types";

export interface BriefPromptInput {
  handle: string;
  creator_name: string | null;
  niche: string[];
  tier: string | null;
  followers: number | null;
  creator_notes: string | null;
  deal_notes: string | null;
  kit_name: string | null;
  kit_items: { title: string; qty: number }[];
  deliverables: Deliverables;
  usage_rights: UsageRights;
  usage_rights_days: number | null;
  discount_code: string | null;
  draft_due: string | null; // human date or a "N days after the box arrives" phrase
  go_live: string | null;
  /** Campaign hero product (influencer_settings.brief_focus); null = whole range. */
  focus?: string | null;
  focus_notes?: string | null;
}

// Words in a focus name that say nothing about WHICH product it is.
const FOCUS_STOPWORDS = new Set(["roasted", "fried", "promunch", "snack", "snacks", "the", "and", "new", "range", "line", "pack", "packs"]);

/** Lower-case words that identify the focus product ("Roasted Edamame" → ["edamame"]). */
export function focusKeywords(focus: string | null | undefined): string[] {
  if (!focus) return [];
  const words = focus.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const specific = words.filter((w) => !FOCUS_STOPWORDS.has(w));
  return specific.length ? specific : words;
}

const KB_BUDGET = 12000;
const FOCUS_FACTS_BUDGET = 6000;

/**
 * The KB text for the prompt. With a focus product, every KB paragraph that
 * names it goes FIRST (so the 12k budget can never cut those facts off), then
 * the rest of the KB fills what is left. Pure; `full` is the untruncated KB.
 */
export function buildBriefKb(full: string, focus: string | null | undefined): string {
  const keys = focusKeywords(focus);
  if (!keys.length || !full) return full.slice(0, KB_BUDGET);
  const paras = full.split(/\n\s*\n/);
  const hit = (p: string) => keys.some((k) => p.toLowerCase().includes(k));
  let facts = "";
  for (const p of paras.filter(hit)) {
    if (facts.length + p.length + 2 > FOCUS_FACTS_BUDGET) break;
    facts += (facts ? "\n\n" : "") + p.trim();
  }
  if (!facts) return full.slice(0, KB_BUDGET);
  const head = `### ${focus} facts (the hero product of this campaign)\n${facts}`;
  const rest = paras.filter((p) => !hit(p)).join("\n\n");
  return `${head}\n\n## Rest of the knowledge base\n${rest}`.slice(0, KB_BUDGET);
}

// Briefs are low volume and creator-facing, so they use the stronger model
// (gpt-4o-mini wrote generic hooks and mixed per-100 g with per-serving facts).
export const BRIEF_MODEL = "gpt-4.1";

export const BRIEF_SYSTEM_PROMPT =
  `You write creator briefs for PROMUNCH, an Indian high-protein snack brand ("Your Munchy Pal"). ` +
  `The brief goes to an Instagram creator doing a barter collab (free product for content, no fee).\n` +
  `STRICT RULES:\n` +
  `1. Always write the brand name as "PROMUNCH" in all caps.\n` +
  `2. NEVER use em dashes or en dashes. Use commas or full stops.\n` +
  `3. Product facts (flavours, protein numbers, ingredients, roasted vs fried, prices) come ONLY from the BRAND KNOWLEDGE BASE. ` +
  `If a fact is not there, do not state it. Chips and sticks are FRIED; only Crunchies are roasted. Never call chips or sticks roasted.\n` +
  `4. No medical or health claims: no cures, no disease, no weight loss promises, no "doctor recommended".\n` +
  `5. Never mention any fee or payment. This is barter only.\n` +
  `6. Warm, friendly, creator-to-creator tone. Simple English. Short sentences.\n` +
  `7. Tailor the concept, hooks and script to the creator's niche and audience.\n` +
  `8. Never mention Oltaflock.`;

export function buildBriefUserPrompt(input: BriefPromptInput, kb: string): string {
  const niche = input.niche.length ? input.niche.join(", ") : "(unknown, keep it broadly lifestyle)";
  const kit = input.kit_items.length
    ? input.kit_items.map((i) => `- ${i.qty} x ${i.title}`).join("\n")
    : "(kit not chosen yet, refer to 'the PROMUNCH box')";
  const deliv = deliverablesLine(input.deliverables);
  const focus = input.focus?.trim() || null;
  return [
    `BRAND KNOWLEDGE BASE (the only source of product facts):`,
    kb || "(empty: state no specific product facts beyond the product names in the kit)",
    ``,
    `CREATOR: @${input.handle}${input.creator_name ? ` (${input.creator_name})` : ""}`,
    `NICHE: ${niche}`,
    `TIER: ${input.tier ?? "unknown"}${input.followers ? `, ${input.followers} followers` : ""}`,
    input.creator_notes ? `NOTES ABOUT THE CREATOR: ${input.creator_notes}` : ``,
    input.deal_notes ? `NOTES ABOUT THIS COLLAB: ${input.deal_notes}` : ``,
    ``,
    `KIT THEY RECEIVE (${input.kit_name ?? "PROMUNCH box"}):`,
    kit,
    ``,
    `DELIVERABLES: ${deliv}`,
    `DRAFT DUE: ${input.draft_due ?? "within the agreed days after the box arrives"}`,
    `GO LIVE: ${input.go_live ?? "after we approve the draft"}`,
    `DISCOUNT CODE FOR THEIR AUDIENCE: ${input.discount_code ?? "(none)"}`,
    focus ? `HERO PRODUCT OF THIS CAMPAIGN: ${focus}` : ``,
    focus && input.focus_notes?.trim() ? `CAMPAIGN ANGLE: ${input.focus_notes.trim()}` : ``,
    `USAGE RIGHTS: ${input.usage_rights === "none" ? "none (do not write usage rights text)" : `${input.usage_rights}${input.usage_rights_days ? ` for ${input.usage_rights_days} days` : ""}`}`,
    ``,
    `Write the brief. Requirements:`,
    focus
      ? `- The WHOLE brief is about ${focus}. Concept, all 3 hooks, the script, talking points and must_say centre on ${focus} and its facts from the "${focus} facts" section (what makes it different, protein, flavours, how it is made). Do not feature or name any other PROMUNCH product, even if the kit has other items. If the kit lists other products, ignore them in the creative.`
      : ``,
    `- concept: 2 to 3 sentences describing ONE specific, filmable scene from this creator's real day (where they are, what happens on camera, the payoff moment), built on a product fact. Not a generic "show how it fits your lifestyle" or "taste test" idea.`,
    `- hooks: exactly 3 opening lines for the first 3 seconds, each a DIFFERENT angle: (a) a surprising, specific fact or comparison from the KB, (b) a relatable POV moment from their niche, (c) a visual reveal or challenge. Write each as "On screen: <what we see>. Say: <the line>". Never open with a generic question like "Looking for a snack?".`,
    `- script: a ${input.deliverables.reels ? "Reel" : "post"} of about 30 to 45 seconds in this creator's voice. One beat per line, each line starting with the shot in square brackets, then the spoken line, e.g. "[close-up, pouring beans into palm] Roasted in olive oil, not fried." End on the discount code${input.discount_code ? ` ${input.discount_code}` : ""} and the product name.`,
    `- Avoid empty praise words: healthy, wholesome, guilt-free, game changer, upgrade, delicious and healthy, must-try. Let specific facts do the selling.`,
    `- talking_points: 3 to 5 points to weave in, product facts only from the KB.`,
    `- must_say: 1 to 3 short lines that must be said or shown (brand name PROMUNCH, product name).`,
    `- checklist: include "Tag ${PROMUNCH_IG_HANDLE}", "Send ${PROMUNCH_IG_HANDLE} an Instagram Collab invite",` +
      `${input.discount_code ? ` "Share code ${input.discount_code}",` : ""} and "Deliverables: ${deliv}". Add 1 to 3 practical items (good light, show the pack clearly).`,
    `- donts: 3 to 6 items. Must include no medical or health claims. Also no competitor brands, no fee talk.`,
    `- format: length_sec (number), aspect ("9:16" for Reels), stories (number of stories).`,
    `- usage_rights_text: ${input.usage_rights === "none" ? "null" : "one friendly sentence explaining the rights"}.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** OpenAI structured-output schema for the AI-written parts of BriefContent. */
export const BRIEF_JSON_SCHEMA = {
  name: "influencer_brief",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["concept", "hooks", "script", "talking_points", "must_say", "checklist", "donts", "format", "usage_rights_text"],
    properties: {
      concept: { type: "string" },
      hooks: { type: "array", items: { type: "string" } },
      script: { type: "string" },
      talking_points: { type: "array", items: { type: "string" } },
      must_say: { type: "array", items: { type: "string" } },
      checklist: { type: "array", items: { type: "string" } },
      donts: { type: "array", items: { type: "string" } },
      format: {
        type: "object",
        additionalProperties: false,
        required: ["length_sec", "aspect", "stories"],
        properties: {
          length_sec: { type: ["number", "null"] },
          aspect: { type: ["string", "null"] },
          stories: { type: ["number", "null"] },
        },
      },
      usage_rights_text: { type: ["string", "null"] },
    },
  },
} as const;
