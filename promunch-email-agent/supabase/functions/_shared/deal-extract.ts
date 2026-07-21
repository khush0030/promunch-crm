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

export type Temperature = "hot" | "warm" | "cool";

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
  willingness: number; // 0-100 read from their tone
  temperature: Temperature;
  sentiment: string | null;
  emotions: string[];
  drivers: string[];
  risks: string[];
  recommended_move: string | null;
}

// Shape stored in deals.insights (jsonb).
export function insightsOf(ex: DealExtraction) {
  return {
    willingness: ex.willingness,
    temperature: ex.temperature,
    sentiment: ex.sentiment,
    emotions: ex.emotions,
    drivers: ex.drivers,
    risks: ex.risks,
    recommended_move: ex.recommended_move,
  };
}

const SYSTEM_PROMPT =
  `You are the deal-pipeline analyst for PROMUNCH, a D2C high-protein soya snacks brand in India (hello@promunch.in). You read one email thread and output ONE JSON object describing the commercial conversation, if any.

A thread IS a deal (is_deal=true) when it is a commercial conversation with a counterparty of one of these kinds. Definitions (use EXACTLY these values for "kind"):
- "hotel_hospitality": HoReCa BUYING PROMUNCH to serve or stock in their food-service operation — hotels, resorts, restaurants, cafes, caterers, cloud kitchens, airline/institutional catering. The test is procurement intent: samples for their menu, rates, MOQs, supply.
- "corporate_pantry_gifting": companies buying for office pantries, employee snacks, or client/festive gift hampers.
- "retail_qcommerce": getting PROMUNCH listed or stocked — marketplaces, quick-commerce (Blinkit, Zepto, Instamart), supermarkets, gyms, kirana/store chains.
- "distribution_wholesale": distributors, super-stockists, wholesalers, vending-machine networks.
- "influencer_collab": an individual creator, celebrity, or their manager/talent agency proposing CONTENT about PROMUNCH — Instagram reels/posts/stories, YouTube, UGC, affiliate codes, barter ("send products, I will post") or paid promotion. Cues: follower counts, engagement stats, media kits, @handles, "collab", "barter", personal/freemail addresses, portfolio links.
- "brand_partnership": another consumer BRAND (a company, not a person) proposing co-marketing, bundles, giveaways, or cross-promotion.
- "events_expo": trade fairs or expos PROMUNCH exhibits or samples at.
- "vendor_pitch": anyone selling services or goods TO PROMUNCH — marketing/PR/influencer-marketing agencies selling campaign management, stall fabricators, SaaS, packaging, machinery, ingredient suppliers.
- "other": a genuine commercial conversation that fits none of the above.

Kind disambiguation, apply in this order:
1. Someone offering to CREATE CONTENT or promote PROMUNCH to their audience is "influencer_collab" — even if they run a cafe/hotel/brand page, mention hospitality clients, or only want free product as barter.
2. An agency selling influencer-marketing SERVICES for a fee (they manage campaigns; they are not the creator) is "vendor_pitch".
3. "hotel_hospitality" requires intent to BUY/serve PROMUNCH in a food-service operation. A hotel's marketing person asking for a collab post is "influencer_collab"; their procurement asking for samples and rates is "hotel_hospitality".
4. Company proposing co-marketing = "brand_partnership"; individual creator = "influencer_collab".

A thread is NOT a deal (is_deal=false): customer support or order queries, job applications, newsletters/digests, automated notifications and receipts, event invitations PROMUNCH is merely invited to attend, pure spam.

Fields:
- is_deal: TRUE for ANY commercial conversation of the kinds listed above, at ANY stage — a first cold pitch, an early discussion, a vendor pitching us, expo logistics. "Deal" means "conversation worth tracking in the pipeline", NOT "agreement reached". FALSE only for: customer support/order queries, job applications, newsletters/digests, automated notifications/receipts, invitations to merely attend an event, pure spam.
- company_name: the counterparty (company, or the person's name for individual influencers). Short, canonical ("Oberoi Hotels", not "RE: Oberoi").
- company_domain: their email domain, lowercase, null for freemail (gmail etc).
- kind: one of ${
    JSON.stringify(DEAL_KINDS)
  }, per the definitions above. Always re-judge kind from the emails themselves; if a tracked-deal hint supplies a kind, treat it as possibly wrong.
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

Relationship read — study the counterparty's tone, word choice, response speed and effort:
- willingness: 0-100. How willing/eager are THEY to do this deal? 80+ = actively pushing it forward (asking for rates, looping in decision makers, proposing dates). 50-79 = engaged but not driving. 20-49 = polite but passive. <20 = cold, going through motions, or ghosting.
- temperature: "hot" (willingness >= 70), "warm" (40-69), "cool" (< 40).
- sentiment: one sentence on how they come across ("Enthusiastic and fast to reply; procurement is engaged", "Formal and slow, deflecting to process").
- emotions: 2-4 single words read from their messages (e.g. "curious", "enthusiastic", "hesitant", "impatient", "transactional").
- drivers: up to 3 short phrases on what THEY care about (price, health angle, exclusivity, timelines, brand fit).
- risks: up to 3 short phrases on what could kill this (silence, budget, competing vendor, single champion, deadline).
- recommended_move: ONE concrete action PROMUNCH should take next, imperative, specific ("Send the rate card with hamper MOQs today and propose a tasting date"). No em dashes.

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
  const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
        .map((x) => x.trim().slice(0, maxLen))
        .slice(0, maxItems)
      : [];
  const willingness = typeof obj.willingness === "number"
    ? Math.min(100, Math.max(0, Math.round(obj.willingness)))
    : 50;
  const temperature: Temperature =
    obj.temperature === "hot" || obj.temperature === "warm" || obj.temperature === "cool"
      ? obj.temperature
      : willingness >= 70
      ? "hot"
      : willingness >= 40
      ? "warm"
      : "cool";
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
    willingness,
    temperature,
    sentiment: str(obj.sentiment, 300),
    emotions: strList(obj.emotions, 4, 40),
    drivers: strList(obj.drivers, 3, 120),
    risks: strList(obj.risks, 3, 120),
    recommended_move: str(obj.recommended_move, 300),
  };
}

export async function extractDeal(
  transcript: string,
  existingHint: { company_name: string; stage: string; kind: string } | null,
): Promise<DealExtraction> {
  const hint = existingHint
    ? `\n\nThis thread already belongs to a tracked deal: ${
      JSON.stringify(existingHint)
    }. Judge the CURRENT state given the newest messages, and re-check kind against the definitions — the stored kind may be misclassified.`
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
