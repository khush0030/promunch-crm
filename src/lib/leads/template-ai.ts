// AI helpers for the template system — OpenAI via plain fetch, same pattern
// as draft.ts. Two jobs:
//  1. polishOpening: per-lead rewrite of ONLY a template's first paragraph so
//     a saved template still opens with something specific to the recipient.
//  2. generateTemplateVariants: "Draft with AI" in the template editor — turns
//     a one-line brief into 3 template options (with {variables}) to pick from.
import { DRAFT_MODEL } from './draft';
import type { Enrichment } from '@/components/leads/types';

const COPY_RULES = `Rules that always apply:
- Always write the brand name as PROMUNCH in all caps.
- Never use em dashes anywhere.
- Indian business English; warm but professional, no hype.
- State product facts ONLY if they appear in the KNOWLEDGE BASE provided; never invent flavours, prices, protein numbers or preparation method.`;

async function chatJson(system: string, user: string, temperature: number): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: DRAFT_MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');
  return content;
}

export interface PolishInput {
  body: string; // fully rendered template body (variables already substituted)
  lead: {
    name: string;
    category: string | null;
    city: string | null;
    site_snippet: string | null;
    enrichment: Enrichment | null;
  };
}

/**
 * Rewrite ONLY the opening paragraph to reference the recipient company.
 * Best-effort: any failure returns the body unchanged so a send never blocks
 * on OpenAI.
 */
export async function polishOpening(input: PolishInput): Promise<string> {
  const paragraphs = input.body.split(/\n{2,}/);
  if (paragraphs.length < 2) return input.body; // nothing safely rewritable
  const [opening, ...rest] = paragraphs;

  try {
    const e = input.lead.enrichment;
    const system = `You personalise the FIRST paragraph of a B2B cold email for PROMUNCH, an Indian high-protein snack brand.
Rewrite the opening so it references the recipient company specifically, at most 2 short sentences, keeping the same greeting style and intent. Do not add claims about PROMUNCH products. Never invent facts about the recipient; only use the details provided.
${COPY_RULES}
Return JSON: {"opening": "..."}`;
    const user = [
      `Current opening paragraph: ${opening}`,
      `Recipient company: ${input.lead.name}`,
      input.lead.category ? `Business type: ${input.lead.category}` : null,
      input.lead.city ? `City: ${input.lead.city}` : null,
      e?.summary ? `What they do: ${e.summary}` : null,
      e?.talkingPoints?.length ? `Hooks (pick one): ${e.talkingPoints.join('; ')}` : null,
      input.lead.site_snippet ? `From their website: ${input.lead.site_snippet.slice(0, 500)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const content = await chatJson(system, user, 0.7);
    const parsed = JSON.parse(content) as { opening?: string };
    const polished = parsed.opening?.trim();
    if (!polished || polished.length > opening.length * 3) return input.body;
    return [polished, ...rest].join('\n\n');
  } catch {
    return input.body;
  }
}

export interface TemplateVariant {
  label: string;
  subject: string;
  body: string;
}

export interface VariantInput {
  brief: string; // what the user wants to pitch
  products?: string[] | null;
  knowledgeBase: string;
}

/** Generate 3 distinct template drafts (direct / proof-led / short) with {variables}. */
export async function generateTemplateVariants(input: VariantInput): Promise<TemplateVariant[]> {
  const kb = input.knowledgeBase.trim();
  const system = `You write reusable B2B cold-email TEMPLATES for PROMUNCH (promunch.in), an Indian D2C high-protein snack brand ("Your Munchy Pal"). The sender is Parth, Founder, PROMUNCH.

Templates are sent to many companies, so use these placeholder tokens instead of specifics about the recipient: {name} (recipient person/team), {company}, {city}, {category}. Use {company} at least once in the body. Do not invent recipient details.

Produce exactly 3 variants with different angles:
1. label "Direct" - leads with the concrete offer (sample box + 15-minute call).
2. label "Proof" - opens with PROMUNCH traction or product strength from the KNOWLEDGE BASE, then the offer.
3. label "Short" - 3 sentences maximum, one clear question.

Each body: under 130 words, plain text, greeting on its own paragraph, sign-off "Parth\nFounder, PROMUNCH", and end with this exact opt-out paragraph: Reply "no thanks" and I won't write again.
Each subject: under 60 characters, may use {company}.
${COPY_RULES}
${kb ? `\nKNOWLEDGE BASE (the ONLY source of product facts):\n${kb}` : ''}

Return JSON: {"variants": [{"label": "...", "subject": "...", "body": "..."}]}`;

  const user = [
    `PITCH BRIEF: ${input.brief.trim()}`,
    input.products?.length ? `FEATURE THESE PROMUNCH PRODUCTS: ${input.products.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const content = await chatJson(system, user, 0.8);
  const parsed = JSON.parse(content) as { variants?: Partial<TemplateVariant>[] };
  const variants = (parsed.variants ?? [])
    .filter((v): v is TemplateVariant => !!v.label && !!v.subject && !!v.body)
    .slice(0, 3)
    .map((v) => ({ label: v.label.trim(), subject: v.subject.trim(), body: v.body.trim() }));
  if (!variants.length) throw new Error('OpenAI returned no usable variants');
  return variants;
}
