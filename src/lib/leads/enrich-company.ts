// Stage 3 — company enrichment. After the site is crawled, profile the company
// from its Places data + site text into structured intel the cold-email drafter
// can use to personalise sharply (and the dashboard can show). gpt-4o-mini,
// ~$0.0002/lead. Best-effort: callers must tolerate it throwing.

import { getSecret } from '@/lib/secrets';

export interface EnrichInput {
  companyName: string;
  category: string | null;
  city: string | null;
  types: string[] | null;
  siteSnippet: string | null;
}

export interface CompanyEnrichment {
  summary: string; // 1-2 sentences: what they actually do
  scale: string; // rough size/scale signal, e.g. "Mid-size agency, multi-city clients"
  fitAngle: string; // the single best PROMUNCH angle for them
  decisionMaker: string; // role most likely to own this buy, e.g. "Procurement / Gifting lead"
  talkingPoints: string[]; // 2-3 concrete hooks to reference in the email
}

const SYSTEM_PROMPT = `You are a B2B sales researcher for PROMUNCH (promunch.in), an Indian high-protein plant-based snack brand selling to businesses (corporate gifting, office pantry, hotel/airline/caterer supply, vending).

From the evidence about a target company, produce a tight enrichment profile to help personalise a cold email. Use ONLY the evidence given — never invent specifics (no made-up client names, headcounts, or revenue). If evidence is thin, say so plainly and keep it general.

Return JSON exactly:
{
  "summary": "<1-2 sentences on what this company actually does>",
  "scale": "<short size/scale read from the evidence, e.g. 'Boutique Pune gifting studio' or 'Pan-India corporate gifting firm'>",
  "fitAngle": "<the single best PROMUNCH angle for THIS company, concrete>",
  "decisionMaker": "<the role most likely to own this purchase, e.g. 'Procurement / corporate gifting lead'>",
  "talkingPoints": ["<concrete hook 1>", "<concrete hook 2>"]
}
Keep every field short. talkingPoints: 2-3 items, each under 14 words, grounded in the evidence.`;

export async function enrichCompany(input: EnrichInput): Promise<CompanyEnrichment> {
  const apiKey = await getSecret('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const userPrompt = [
    `Company: ${input.companyName}`,
    input.category ? `Found via search: ${input.category}` : null,
    input.city ? `City: ${input.city}` : null,
    input.types?.length ? `Google Places types: ${input.types.join(', ')}` : null,
    input.siteSnippet ? `From their website: ${input.siteSnippet}` : 'No website text available.',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI enrich ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');
  const p = JSON.parse(content) as Partial<CompanyEnrichment>;
  return {
    summary: String(p.summary ?? '').slice(0, 400),
    scale: String(p.scale ?? '').slice(0, 160),
    fitAngle: String(p.fitAngle ?? '').slice(0, 240),
    decisionMaker: String(p.decisionMaker ?? '').slice(0, 120),
    talkingPoints: Array.isArray(p.talkingPoints)
      ? p.talkingPoints.slice(0, 3).map((t) => String(t).slice(0, 120))
      : [],
  };
}
