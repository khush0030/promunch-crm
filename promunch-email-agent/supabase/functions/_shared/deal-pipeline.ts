// Pure helpers for the deal-scan pipeline (no network, no DB) — keep them
// pure so deal-pipeline_test.ts runs without secrets.

// The AI's vocabulary (deal-extract.ts prompts with these): fine-grained so
// the model can say exactly what it read. The CRM pipeline stores the
// simpler owner-approved stages (PIPELINE_STAGES) since migration
// 20261010100000_deals_simplify.sql; toPipelineStage maps one onto the other.
export const DEAL_STAGES = [
  "new_inquiry",
  "in_discussion",
  "samples_requested",
  "samples_sent",
  "negotiation",
  "won",
  "lost",
  "dormant",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const PIPELINE_STAGES = [
  "new",
  "talking",
  "samples",
  "negotiating",
  "won",
  "lost",
  "on_hold",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const AI_TO_PIPELINE: Record<DealStage, PipelineStage> = {
  new_inquiry: "new",
  in_discussion: "talking",
  samples_requested: "samples",
  samples_sent: "samples",
  negotiation: "negotiating",
  won: "won",
  lost: "lost",
  dormant: "on_hold",
};

const PIPELINE_TO_AI: Record<PipelineStage, DealStage> = {
  new: "new_inquiry",
  talking: "in_discussion",
  samples: "samples_requested",
  negotiating: "negotiation",
  won: "won",
  lost: "lost",
  on_hold: "dormant",
};

/** Any stage name (AI / old DB / new DB) to the pipeline stage. */
export function toPipelineStage(s: string | null | undefined): PipelineStage {
  if (s && (PIPELINE_STAGES as readonly string[]).includes(s)) return s as PipelineStage;
  if (s && s in AI_TO_PIPELINE) return AI_TO_PIPELINE[s as DealStage];
  return "new";
}

/** Pipeline stage to the old DB / AI name (pre-migration writes, AI hints). */
export function toAiStage(s: PipelineStage): DealStage {
  return PIPELINE_TO_AI[s];
}

export const DEAL_KINDS = [
  "hotel_hospitality",
  "corporate_pantry_gifting",
  "retail_qcommerce",
  "distribution_wholesale",
  "influencer_collab",
  "brand_partnership",
  "events_expo",
  "vendor_pitch",
  "other",
] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

// Stage ratchet order. on_hold sits below everything so any real signal
// revives a paused deal; won/lost are terminal.
const STAGE_ORDER: Record<PipelineStage, number> = {
  on_hold: 0,
  new: 1,
  talking: 2,
  samples: 3,
  negotiating: 4,
  won: 5,
  lost: 5,
};

const TERMINAL: PipelineStage[] = ["won", "lost"];

// Deals move forward automatically, never backwards on their own. A human
// stage edit (manualOverride) always wins; AI can still close a deal
// (won/lost) and any signal revives an on-hold one.
export function mergeStage(
  existing: PipelineStage,
  incoming: PipelineStage,
  manualOverride: boolean,
): PipelineStage {
  if (manualOverride) return existing;
  if (TERMINAL.includes(existing)) return existing;
  if (TERMINAL.includes(incoming)) return incoming;
  if (existing === "on_hold") return incoming;
  return STAGE_ORDER[incoming] > STAGE_ORDER[existing] ? incoming : existing;
}

/**
 * True while a human decision (stage / next step / follow-up, stamped as
 * human_touched_at) must stand: the scanner may not rewrite next step or
 * follow-up until an inbound email arrives AFTER that decision.
 */
export function humanDecisionStands(
  humanTouchedAtMs: number | null,
  lastInboundAtMs: number | null,
): boolean {
  if (!humanTouchedAtMs) return false;
  return !(lastInboundAtMs && lastInboundAtMs > humanTouchedAtMs);
}

const NOISE_SENDER_RE = [
  /mailer-daemon/i,
  /postmaster@/i,
  /no-?reply/i,
  /do-?not-?reply/i,
  /^notifications?@/i,
  /@(accounts\.)?google\.com$/i,
  /@calendar-server\.bounces\.google\.com$/i,
  /@zoom\.us$/i,
  /@tldv\.io$/i,
  /@substack\.com$/i,
  /@scoop\.it$/i,
  /@gokwikmail\.com$/i,
  /@shopify\.com$/i,
  /@stripe\.com$/i,
  /@razorpay\.com$/i,
  /@vercel\.com$/i,
  /@supabase\.(io|com)$/i,
  /@slack\.com$/i,
];

// Cheap pre-filter so obvious machine mail never burns an OpenAI call.
// Anything that passes still gets judged by the model (is_deal).
export function isNoiseSender(from: string): boolean {
  const addr = extractAddress(from).toLowerCase();
  if (!addr) return true;
  return NOISE_SENDER_RE.some((re) => re.test(addr));
}

// "Name <a@b.c>" -> "a@b.c"; plain addresses pass through.
export function extractAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.in",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "rediffmail.com",
  "protonmail.com",
  "proton.me",
]);

export function emailDomain(raw: string): string | null {
  const addr = extractAddress(raw);
  const at = addr.lastIndexOf("@");
  if (at < 1) return null;
  return addr.slice(at + 1).toLowerCase() || null;
}

// Dedup key for companies. Freemail domains identify a person, not a
// company, so they return null and the scanner falls back to name matching.
export function companyDomainOf(raw: string): string | null {
  const d = emailDomain(raw);
  if (!d || FREEMAIL.has(d)) return null;
  return d;
}

export interface TranscriptMsg {
  from: string;
  to: string;
  subject: string;
  dateIso: string;
  body: string;
}

const PER_MSG_CHARS = 1500;

// Chronological transcript for the model. Long threads keep the head (how it
// started) and tail (where it stands) and drop the middle.
export function buildTranscript(msgs: TranscriptMsg[], mailbox: string, maxChars = 12000): string {
  const entries = msgs.map((m) => {
    const dir = m.from.toLowerCase().includes(mailbox.toLowerCase())
      ? "US (PROMUNCH)"
      : `THEM (${m.from})`;
    const body = m.body.replace(/\s+/g, " ").trim().slice(0, PER_MSG_CHARS);
    return `--- ${m.dateIso} · ${dir}\nSubject: ${m.subject}\n${body}`;
  });
  let kept = entries;
  let omitted = 0;
  while (kept.length > 4 && kept.join("\n\n").length > maxChars) {
    // drop from the middle
    kept = [...kept.slice(0, 2), ...kept.slice(3)];
    omitted++;
  }
  const parts = omitted > 0
    ? [...kept.slice(0, 2), `[... ${omitted} earlier message(s) omitted ...]`, ...kept.slice(2)]
    : kept;
  return parts.join("\n\n").slice(0, maxChars + 500);
}

export interface FollowUpInput {
  stage: PipelineStage;
  lastEmailAtMs: number | null;
  lastDirection: "inbound" | "outbound" | null;
  samplesSentAtMs: number | null;
  aiFollowUp?: boolean;
  aiReason?: string | null;
}

const DAY = 86_400_000;

// Deterministic follow-up rules layered over the AI's own flag. Priority:
// they're waiting on us > samples aging > they went quiet > AI hunch.
export function computeFollowUp(
  input: FollowUpInput,
  nowMs: number,
): { needed: boolean; reason: string | null } {
  if (input.stage === "lost") return { needed: false, reason: null };
  const age = input.lastEmailAtMs ? Math.floor((nowMs - input.lastEmailAtMs) / DAY) : null;

  if (input.stage !== "won") {
    if (input.lastDirection === "inbound" && age !== null && age >= 2) {
      return { needed: true, reason: `Their message has waited ${age} days for our reply` };
    }
    if (input.stage === "samples" && input.samplesSentAtMs) {
      const sAge = Math.floor((nowMs - input.samplesSentAtMs) / DAY);
      if (sAge >= 7) {
        return { needed: true, reason: `Samples sent ${sAge} days ago with no feedback. Nudge them` };
      }
    }
    if (
      input.lastDirection === "outbound" && age !== null && age >= 5 && input.stage !== "on_hold"
    ) {
      return { needed: true, reason: `No reply from them in ${age} days. Send a nudge` };
    }
  }
  if (input.aiFollowUp) return { needed: true, reason: input.aiReason || "Flagged by inbox scan" };
  return { needed: false, reason: null };
}

const ON_HOLD_AFTER_DAYS = 45;

// Auto-park deals that went silent for 45+ days, unless a human pinned the
// stage or made a decision since. Any new email revives them via mergeStage.
export function shouldPutOnHold(
  stage: PipelineStage,
  lastEmailAtMs: number | null,
  manualOverride: boolean,
  nowMs: number,
  humanTouchedAtMs: number | null = null,
): boolean {
  if (manualOverride || TERMINAL.includes(stage) || stage === "on_hold") return false;
  if (!lastEmailAtMs) return false;
  if (humanTouchedAtMs && nowMs - humanTouchedAtMs < ON_HOLD_AFTER_DAYS * DAY) return false;
  return nowMs - lastEmailAtMs > ON_HOLD_AFTER_DAYS * DAY;
}
