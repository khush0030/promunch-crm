// AI "ProMunch fit" score — how good a B2B prospect this company is for
// ProMunch (corporate gifting / office pantry / catering supply). Scored once
// after crawl from the Places data + site snippet; gpt-4o-mini, ~$0.0001/lead.

import { getSecret } from '@/lib/secrets';

export interface FitInput {
  companyName: string;
  category: string | null;
  city: string | null;
  types: string[] | null;
  siteSnippet: string | null;
}

export interface FitOutput {
  score: number; // 0-100
  reason: string; // short, shown in the dashboard table
}

const SYSTEM_PROMPT = `You score B2B leads for ProMunch (promunch.in), an Indian D2C high-protein snack brand (roasted soya sticks/chips, vegan, ₹399–499 packs) looking for business buyers.

Score 0-100 how strong this company is as a ProMunch B2B prospect:
- 80-100: directly buys/curates food or snacks for businesses at volume — corporate gifting curators/hamper companies, office pantry suppliers, airline/corporate caterers, hotel procurement, employee-engagement gifting platforms
- 60-79: regularly gifts or feeds at scale but food is one option among many — general corporate gifting agencies, event managers, large offices/coworking with pantry budgets
- 40-59: plausible but indirect — promotional merchandise printers, small agencies, unclear scale
- 0-39: poor fit — sells unrelated goods (bags, electronics, trophies), retail-only, marketplace listing pages, or can't tell what they do

Judge from the evidence given; thin evidence caps the score at 60. Never invent facts.

Return JSON: {"score": <int>, "reason": "<max 12 words, concrete, e.g. 'Curates festival hampers for corporates — snacks fit their boxes'>"}`;

export async function scoreFit(input: FitInput): Promise<FitOutput> {
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
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI fit ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');
  const parsed = JSON.parse(content) as Partial<FitOutput>;
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
  if (Number.isNaN(score) || !parsed.reason) throw new Error('fit JSON missing score/reason');
  return { score, reason: String(parsed.reason).slice(0, 120) };
}
