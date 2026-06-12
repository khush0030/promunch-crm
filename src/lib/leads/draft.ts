// AI cold-email drafting for B2B outreach — OpenAI via plain fetch
// (same pattern as promunch-email-agent/supabase/functions/_shared/openai.ts).

export interface DraftInput {
  companyName: string;
  category: string | null;
  city: string | null;
  roleHint: string | null; // who we're writing to: hr | sales | info | ...
  siteSnippet: string | null;
}

export interface DraftOutput {
  subject: string;
  body: string;
}

export const DRAFT_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You write short B2B cold emails for ProMunch (promunch.in), an Indian D2C high-protein snack brand — roasted soya sticks and soya chips ("Your Munchy Pal"), vegan, gluten-free, ₹399–499 retail packs.

Pitch angles (pick the ONE that best fits the recipient company):
- Corporate gifting: healthy snack hampers for festivals, employee gifts, client gifts
- Office pantry: healthy snacking for employees, bulk supply
- Catering/hospitality (airlines, hotels, caterers): healthy packaged snack for guests/passengers

Offer: a free sample box and a 15-minute call.

Rules:
- Under 150 words, plain text only (no markdown, no HTML, no bullet lists)
- Indian business English; warm but professional, no hype or exaggerated health claims
- Exactly one specific reference to the recipient company (use the provided details; never invent facts)
- If writing to an HR/admin inbox, address the HR/admin team; if a generic info@ inbox, address "the team at <company>"
- Sign off as the founder's office of ProMunch (no fake personal familiarity)
- End the body with this exact opt-out line on its own paragraph: Reply "no thanks" and I won't write again.

Return JSON: {"subject": "...", "body": "..."}. Subject under 60 characters, specific, no clickbait, no emoji.`;

export async function generateDraft(input: DraftInput): Promise<DraftOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const userPrompt = [
    `Company: ${input.companyName}`,
    input.category ? `Business type: ${input.category}` : null,
    input.city ? `City: ${input.city}` : null,
    input.roleHint ? `Recipient inbox type: ${input.roleHint}` : null,
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
        { role: 'system', content: SYSTEM_PROMPT },
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
