// Lightweight email classifier — runs once per inbound message before
// drafting. Returns lead category, urgency, score (0-10), and a 1-line
// rationale. Best-effort: failures never block the pipeline (returns null).

import OpenAI from "npm:openai@4.78.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
// Triage is cheap by design — keep this on the smaller model.
const MODEL = Deno.env.get("OPENAI_CLASSIFY_MODEL")
  ?? Deno.env.get("OPENAI_MODEL")
  ?? "gpt-4o-mini";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY });
  return _client;
}

export type LeadCategory =
  | "customer_support"
  | "order_tracking"
  | "complaint"
  | "partnership_inquiry"
  | "wholesale"
  | "job_application"
  | "newsletter"
  | "marketing"
  | "transactional"
  | "automated_notification"
  | "spam"
  | "general";

export type Urgency = "low" | "medium" | "high" | "critical";

export interface Classification {
  lead_category: LeadCategory;
  urgency: Urgency;
  score: number;        // 0-10 — overall importance (commercial + customer-impact)
  rationale: string;    // one short line
  should_reply: boolean; // false for newsletters, notifications, marketing, noreply, etc.
}

const SYSTEM_BASE = `You are an email triage classifier for PROMUNCH (a snack brand). Read the incoming email and respond with ONLY a JSON object — no prose, no code fences, just JSON.

Schema:
{
  "lead_category": one of "customer_support"|"order_tracking"|"complaint"|"partnership_inquiry"|"wholesale"|"job_application"|"newsletter"|"marketing"|"transactional"|"automated_notification"|"spam"|"general",
  "urgency": one of "low"|"medium"|"high"|"critical",
  "score": integer 0-10 representing overall importance,
  "rationale": one short sentence explaining the classification (max 120 chars),
  "should_reply": boolean — true if a human reply is genuinely needed, false otherwise
}

Guidelines:
- "customer_support" = generic help, product questions, account issues. should_reply=true.
- "order_tracking" = "where is my order", delivery questions. should_reply=true.
- "complaint" = damaged item, refund demand, angry customer. should_reply=true.
- "partnership_inquiry" = brand collabs, B2B introductions, media/PR. should_reply=true.
- "wholesale" = bulk buy, distributor, retail stocking. should_reply=true.
- "job_application" = resume, internship, hiring. should_reply=true (we send interview availability).
- "newsletter" = recurring content broadcast we subscribe to (e.g. Substack, marketing digest). should_reply=FALSE.
- "marketing" = vendors pitching their service/product TO us cold (SaaS, agencies, "I have an offer"). should_reply=FALSE unless they directly ask a question we'd want to answer.
- "transactional" = order confirmations, receipts, password resets, shipping updates from services we use. should_reply=FALSE.
- "automated_notification" = platform alerts (GitHub, Google, AWS, Shopify, Stripe, monitoring), system mail, "do-not-reply@…". should_reply=FALSE.
- "spam" = scams, mass blasts, phishing. should_reply=FALSE.
- "general" = anything else from a real human directed at us. should_reply=true by default.

Signals that force should_reply=FALSE regardless of category:
- Sender contains "noreply", "no-reply", "donotreply", "mailer-daemon", "notifications@", "alerts@", "support+@", "bounce@".
- Body is clearly an automated template (unsubscribe footer, "this is an automated message", system-generated content).
- Email is a delivery receipt or read receipt.

Urgency rubric:
- critical: order undelivered >5 days, allergy/health, legal, public complaint risk.
- high: order delay 1-5 days, refund demand, partnership w/ deadline.
- medium: general inquiries needing reply within 24h.
- low: cold pitches, info-only, FYI, newsletters.

Score 0-10: combine urgency + commercial value. Newsletter/automated = 0-2, generic FAQ = 4, wholesale lead = 8, angry refund = 7.`;

import { getNoReplyExamples } from "./brand.ts";

export async function classifyEmail(input: {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  body: string;
}): Promise<Classification | null> {
  try {
    const user = `From: ${input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail}
Subject: ${input.subject ?? "(no subject)"}

${input.body.slice(0, 4000)}`;
    // Inject learned no-reply senders/patterns so the classifier
    // converges on your skip habits over time.
    const learned = await getNoReplyExamples();
    const system = learned
      ? `${SYSTEM_BASE}\n\n---\nLEARNED NO-REPLY EXAMPLES from past human skips (treat these patterns as should_reply=false):\n${learned}`
      : SYSTEM_BASE;

    const resp = await client().chat.completions.create({
      model: MODEL,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = (resp.choices[0]?.message?.content ?? "").trim();
    // gpt-4o-mini with json_object response_format returns pure JSON, but keep
    // the code-fence stripper for safety across future model swaps.
    const jsonStr = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    return {
      lead_category: parsed.lead_category as LeadCategory,
      urgency: parsed.urgency as Urgency,
      score: Math.max(0, Math.min(10, Number(parsed.score) || 0)),
      rationale: String(parsed.rationale ?? "").slice(0, 200),
      should_reply: parsed.should_reply !== false, // default true if missing
    };
  } catch (e) {
    console.warn("classifyEmail failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
