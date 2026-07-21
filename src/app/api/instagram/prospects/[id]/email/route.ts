import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/resend';

export const dynamic = 'force-dynamic';

// Send the collab pitch to a prospect's bio email via Resend. Replies land at
// the normal inbox where the existing email agent drafts responses. Respects
// the shared suppression list (bounces / "no thanks" from B2B outreach).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const { data: prospect } = await supabaseAdmin.from('ig_prospects').select('*').eq('id', id).maybeSingle();
  if (!prospect) return NextResponse.json({ error: 'prospect not found' }, { status: 404 });
  if (!prospect.bio_email) return NextResponse.json({ error: 'prospect has no bio email' }, { status: 400 });

  const subject = (body.subject ?? prospect.pitch_email_subject ?? '').toString().trim();
  const text = (body.body ?? prospect.pitch_email_body ?? '').toString().trim();
  if (!subject || !text) {
    return NextResponse.json({ error: 'no pitch drafted yet — generate the draft first' }, { status: 400 });
  }

  const { data: suppressed } = await supabaseAdmin
    .from('suppressions')
    .select('email, reason')
    .eq('email', prospect.bio_email)
    .maybeSingle();
  if (suppressed) {
    return NextResponse.json({ error: `${prospect.bio_email} is suppressed (${suppressed.reason})` }, { status: 409 });
  }

  const html = text
    .split(/\n{2,}/)
    .map((p: string) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  const sendResult = await sendEmail({ to: prospect.bio_email, subject, html });
  if (sendResult.error) {
    return NextResponse.json({ error: `Resend: ${sendResult.error.message}` }, { status: 502 });
  }

  await supabaseAdmin.from('ig_outreach_log').insert({
    prospect_id: id,
    channel: 'email',
    subject,
    body: text,
    resend_id: sendResult.data?.id ?? null,
  });
  const { data: updated } = await supabaseAdmin
    .from('ig_prospects')
    .update({
      status: 'contacted',
      contacted_at: new Date().toISOString(),
      contacted_via: 'email',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  return NextResponse.json({ ok: true, prospect: updated });
}
