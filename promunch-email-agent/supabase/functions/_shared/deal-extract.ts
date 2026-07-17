// OpenAI extraction for the deal-scan pipeline: one email thread in, one
// structured deal judgement out. parseExtraction is pure (tested).

import OpenAI from "npm:openai@4.78.0";
import { DEAL_KINDS, DEAL_STAGES, type DealKind, type DealStage } from "./deal-pipeline.ts";

// env reads are lazy so pure helpers stay importable in tests without --allow-env
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") ?? "" });
  return _client;
}
function model(): string {
  return Deno.env.get("DEAL_SCAN_MODEL") ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
}

export interface DealExtraction {
  is_deal: boolean;
  company_name: string | null;
  company_domain: string | null;
  kind: DealKind;
  contact_name: string | null;
  contact_email: string | null;
  stage: DealStage;
  samples_requested: boolean;
  samples_sent: boolean;
  next_step: string | null;
  next_step_owner: "us" | "them" | null;
  follow_up_needed: boolean;
  follow_up_reason: string | null;
  commercials: string | null;
  summary: string | null;
  confidence: number;
}

const SYSTEM_PROMPT =
  `You are the deal-pipeline analyst for PROMUNCH, a D2C high-protein soya snacks brand in India (hello@promunch.in). You read one email thread and output ONE JSON object describing the commercial conversation, if any.

A thread IS a deal (is_deal=true) when it is a commercial conversation with a counterparty: hotels/resorts wanting snacks for guests, corporate pantry/gifting, retail or quick-commerce listing (marketplaces, stores), distributors/wholesalers/vending networks, influencer or celebrity collaborations (barter or paid), brand-to-brand partnerships, trade fairs/expos PROMUNCH is exhibiting at, and vendors pitching their services TO PROMUNCH (agencies, stall fabricators, SaaS, machinery, ingredient suppliers — kind="vendor_pitch").

A thread is NOT a deal (is_deal=false): customer support or order queries, job applications, newsletters/digests, automated notifications and receipts, event invitations PROMUNCH is merely invited to attend, pure spam.

Fields:
- company_name: the counterparty (company, or the person's name for individual influencers). Short, canonical ("Oberoi Hotels", not "RE: Oberoi").
- company_domain: their email domain, lowercase, null for freemail (gmail etc).
- kind: one of ${JSON.stringify(DEAL_KINDS)}.
- stage: one of ${JSON.stringify(DEAL_STAGES)}.
  new_inquiry = first contact, no substantive reply yet.
  in_discussion = active back-and-forth about the opportunity.
  samples_requested = they asked for samples / tasting box (not shipped yet).
  samples_sent = samples were dispatched or delivered.
  negotiation = pricing, margins, MOQs, rate cards, contracts, payment terms under discussion.
  won = agreement reached / partnership live / order placed / campaign running.
  lost = they declined, or PROMUNCH declined.
  dormant = clearly fizzled out.
- samples_requested / samples_sent: booleans from explicit evidence in the thread.
- next_step: one short imperative sentence, or null. next_step_owner: "us" if PROMUNCH must act, "them" if waiting on the counterparty.
- follow_up_needed + follow_up_reason: true when the ball is in PROMUNCH's court or the thread is going stale at a live stage.
- commercials: any rates, margins, MOQs, fees, barter terms mentioned — one compact sentence, else null.
- summary: 2-3 plain sentences of where the deal stands. No em dashes.
- confidence: 0-1 for the overall judgement.

Respond with ONLY the JSON object, no markdown fences, no commentary.`;

export function parseExtraction(raw: string): DealExtraction {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`deal extraction returned unparseable JSON: ${cleaned.slice(0, 200)}`);
  }
  const str = (v: unknown, max = 500): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const kind = DEAL_KINDS.includes(obj.kind as DealKind) ? (obj.kind as DealKind) : "other";
  const stage = DEAL_STAGES.includes(obj.stage as DealStage)
    ? (obj.stage as DealStage)
    : "new_inquiry";
  const owner = obj.next_step_owner === "us" || obj.next_step_owner === "them"
    ? obj.next_step_owner
    : null;
  const conf = typeof obj.confidence === "number" ? Math.min(1, Math.max(0, obj.confidence)) : 0.5;
  return {
    is_deal: obj.is_deal === true,
    company_name: str(obj.company_name, 200),
    company_domain: str(obj.company_domain, 120)?.toLowerCase() ?? null,
    kind,
    contact_name: str(obj.contact_name, 120),
    contact_email: str(obj.contact_email, 200)?.toLowerCase() ?? null,
    stage,
    samples_requested: obj.samples_requested === true,
    samples_sent: obj.samples_sent === true,
    next_step: str(obj.next_step),
    next_step_owner: owner,
    follow_up_needed: obj.follow_up_needed === true,
    follow_up_reason: str(obj.follow_up_reason, 300),
    commercials: str(obj.commercials, 600),
    summary: str(obj.summary, 1200),
    confidence: conf,
  };
}

export async function extractDeal(
  transcript: string,
  existingHint: { company_name: string; stage: string; kind: string } | null,
): Promise<DealExtraction> {
  const hint = existingHint
    ? `\n\nThis thread already belongs to a tracked deal: ${
      JSON.stringify(existingHint)
    }. Judge the CURRENT state given the newest messages.`
    : "";
  const res = await client().chat.completions.create({
    model: model(),
    max_tokens: 700,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: transcript + hint },
    ],
  });
  return parseExtraction(res.choices[0]?.message?.content ?? "");
}
