// AI cold-email drafting for B2B outreach — OpenAI via plain fetch
// (same pattern as promunch-email-agent/supabase/functions/_shared/openai.ts).
import { getKnowledgeBase } from './kb';

export interface DraftInput {
  companyName: string;
  category: string | null;
  city: string | null;
  roleHint: string | null; // who we're writing to: hr | sales | info | ...
  siteSnippet: string | null;
  offer?: string | null; // what we're pitching this round (user-supplied brief)
  subjectHint?: string | null; // optional subject-line direction from the user
  enrichment?: { summary?: string; scale?: string; fitAngle?: string; decisionMaker?: string; talkingPoints?: string[] } | null;
  knowledgeBase?: string; // Master KB text; fetched here if omitted
}

export interface DraftOutput {
  subject: string;
  body: string;
}

export const DRAFT_MODEL = 'gpt-4o-mini';

// All product/brand facts live in the injected KNOWLEDGE BASE (the same Master
// KB the WhatsApp + email agents read), never hardcoded here — hardcoded facts
// drift wrong (e.g. claiming the fried Soya Chips/Sticks are "roasted"). The
// prompt forbids stating any product fact not present in that KB.
const SYSTEM_PROMPT_HEADER = `You write short B2B cold emails for PROMUNCH (promunch.in), an Indian D2C high-protein, plant-based snack brand ("Your Munchy Pal").

Pitch angles (pick the ONE that best fits the recipient company):
- Corporate gifting: healthy snack hampers for festivals, employee gifts, client gifts
- Office pantry: healthy snacking for employees, bulk supply
- Catering/hospitality (airlines, hotels, caterers): healthy packaged snack for guests/passengers

If an OUTREACH BRIEF is provided below, lead with exactly that offer/product and let it drive the angle (still pick the framing that fits the recipient). If no brief is given, pick the best angle yourself.
If a SUBJECT HINT is provided, base the subject line on that idea, refined for this recipient (still under 60 chars, specific, no clickbait).

Offer (default): a free sample box and a 15-minute call.

FACTUAL ACCURACY (most important rule):
- State product facts ONLY if they appear in the KNOWLEDGE BASE below. Never invent or guess flavours, prices, protein numbers, certifications, or preparation method.
- Preparation method matters: only call a product "roasted" or "fried" exactly as the KNOWLEDGE BASE says. Do NOT describe a fried product as roasted or vice versa.
- If you are unsure of a specific fact, stay general ("high-protein soya snacks") rather than stating a detail that might be wrong.
- Do not quote a specific price unless it is in the KNOWLEDGE BASE.

Rules:
- Under 150 words, plain text only (no markdown, no HTML, no bullet lists)
- Always write the brand name as PROMUNCH in all caps
- Never use em dashes anywhere in the subject or body
- Indian business English; warm but professional, no hype or exaggerated health claims
- Exactly one specific reference to the recipient company (use the provided details; never invent facts about the recipient)
- If writing to an HR/admin inbox, address the HR/admin team; if a generic info@ inbox, address "the team at <company>"
- Sign off as Parth, Founder, PROMUNCH (he is the real founder; do not invent a title, phone number, or fake personal familiarity)
- End the body with this exact opt-out line on its own paragraph: Reply "no thanks" and I won't write again.

Return JSON: {"subject": "...", "body": "..."}. Subject under 60 characters, specific, no clickbait, no emoji.`;

function buildSystemPrompt(knowledgeBase: string): string {
  const kb = knowledgeBase.trim();
  if (!kb) return SYSTEM_PROMPT_HEADER;
  return `${SYSTEM_PROMPT_HEADER}

KNOWLEDGE BASE (authoritative PROMUNCH brand facts — products, flavours, preparation method, pricing, policies. This is the ONLY source of product facts you may state):
${kb}`;
}

export async function generateDraft(input: DraftInput): Promise<DraftOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  // Ground every product fact in the real Master KB. Fetch here if the caller
  // didn't pass it (batch callers pass it once to avoid re-querying per draft).
  const knowledgeBase = input.knowledgeBase ?? (await getKnowledgeBase());
  const systemPrompt = buildSystemPrompt(knowledgeBase);

  const e = input.enrichment;
  const userPrompt = [
    input.offer?.trim() ? `OUTREACH BRIEF (what we are pitching this round): ${input.offer.trim()}` : null,
    input.subjectHint?.trim() ? `SUBJECT HINT: ${input.subjectHint.trim()}` : null,
    `Company: ${input.companyName}`,
    input.category ? `Business type: ${input.category}` : null,
    input.city ? `City: ${input.city}` : null,
    input.roleHint ? `Recipient inbox type: ${input.roleHint}` : null,
    // Enrichment (stage 3) — use these to personalise; do not contradict them.
    e?.summary ? `What they do: ${e.summary}` : null,
    e?.scale ? `Scale: ${e.scale}` : null,
    e?.fitAngle ? `Best angle for them: ${e.fitAngle}` : null,
    e?.talkingPoints?.length ? `Specific hooks to reference (pick one): ${e.talkingPoints.join('; ')}` : null,
    input.siteSnippet ? `From their website: ${input.siteSnippet}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DRAFT_MODEL,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  const parsed = JSON.parse(content) as Partial<DraftOutput>;
  if (!parsed.subject || !parsed.body) throw new Error('Draft JSON missing subject/body');
  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}

/** Render plain-text draft body as minimal HTML for sending. */
export function bodyToHtml(bodyText: string, footerAddress: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = bodyText
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px 0;">${escape(p)}</p>`)
    .join('\n');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:560px;">
${paragraphs}
<p style="margin:24px 0 0 0;font-size:12px;color:#888;">${escape(footerAddress)}</p>
</div>`;
}
