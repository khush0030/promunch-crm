import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getKnowledgeBase } from '@/lib/leads/kb';
import { getSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

// AI collab pitch for a discovered prospect: a DM flavour (for the manual-send
// assist — Instagram forbids cold DMs via the API, so a human sends it from
// the app) and an email flavour (for the bio-email path). Grounded in the
// Master KB + ig_settings.barter_terms; product facts outside the KB are
// forbidden, same rule as the B2B drafter.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const [{ data: prospect }, { data: settings }] = await Promise.all([
    supabaseAdmin.from('ig_prospects').select('*').eq('id', id).maybeSingle(),
    supabaseAdmin.from('ig_settings').select('barter_terms').eq('id', 1).maybeSingle(),
  ]);
  if (!prospect) return NextResponse.json({ error: 'prospect not found' }, { status: 404 });

  const apiKey = await getSecret('OPENAI_API_KEY');
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 });

  const kb = await getKnowledgeBase();
  const captions = Array.isArray(prospect.last3)
    ? prospect.last3.map((p: { caption?: string | null }) => p?.caption).filter(Boolean).slice(0, 3)
    : [];

  const sys =
    `You write influencer outreach for PROMUNCH (Indian healthy-snack brand, "Your Munchy Pal"), proposing a barter collab.\n` +
    `BRAND COPY RULES (strict): always write "PROMUNCH" in all caps. NEVER use em dashes or en dashes; use commas or full stops. ` +
    `State product facts ONLY if they appear in the KNOWLEDGE BASE. Warm, personal, no hype.`;
  const user = [
    `BRAND KNOWLEDGE BASE:\n${kb || '(none)'}`,
    '',
    `CREATOR: @${prospect.handle}`,
    `NICHE: ${prospect.niche ?? '(unknown)'}`,
    `FOLLOWERS: ${prospect.followers ?? '(unknown)'}`,
    `BIO: ${prospect.biography ?? '(unknown)'}`,
    `RECENT CAPTIONS:\n${captions.length ? captions.map((c: string) => `- ${String(c).slice(0, 160)}`).join('\n') : '(none)'}`,
    '',
    settings?.barter_terms
      ? `OUR BARTER TERMS (base both drafts on these):\n${settings.barter_terms}`
      : '(No barter terms configured. Draft a reasonable product-for-content barter ask.)',
    '',
    `Return JSON ONLY:`,
    `{`,
    `  "dm": "<a warm Instagram DM, 3-5 short sentences, personalised to this creator's content, proposing the barter and asking to confirm interest>",`,
    `  "email_subject": "<under 60 chars, specific, no clickbait>",`,
    `  "email_body": "<the same pitch as a short plain-text email, under 130 words, addressed to the creator by handle or name, signed 'Team PROMUNCH'>"`,
    `}`,
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: err?.error?.message ?? `OpenAI HTTP ${res.status}` }, { status: 502 });
  }
  const data = await res.json();
  let parsed: { dm?: string; email_subject?: string; email_body?: string } = {};
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}'); } catch { /* handled below */ }
  if (!parsed.dm) return NextResponse.json({ error: 'draft generation returned nothing usable' }, { status: 502 });

  const patch = {
    pitch_dm: parsed.dm.trim(),
    pitch_email_subject: (parsed.email_subject ?? '').trim() || null,
    pitch_email_body: (parsed.email_body ?? '').trim() || null,
    pitch_drafted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = await supabaseAdmin
    .from('ig_prospects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, prospect: updated });
}
