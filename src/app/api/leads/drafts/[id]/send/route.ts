import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/resend';
import { bodyToHtml } from '@/lib/leads/draft';

export const maxDuration = 60;

// Approve & send a draft via Resend, from the verified outreach domain
// (trypromunch.in) — kept off the main brand domain so cold outreach can never
// dent the reputation that order/support email depends on. Resend's webhook
// (api/webhooks/resend) tracks delivery/bounce/complaint by resend_email_id and
// auto-suppresses bad addresses, so we store the real Resend id below.
// The atomic claim to 'sending' guarantees a double-click produces exactly one send.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  // Atomic claim: only one caller can move draft/approved -> sending.
  const { data: claimed } = await supabaseAdmin
    .from('outreach_drafts')
    .update({ status: 'sending', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['draft', 'approved', 'failed'])
    .select('*');
  const draft = claimed?.[0];
  if (!draft) {
    return NextResponse.json({ error: 'draft is not sendable (already sent or discarded?)' }, { status: 409 });
  }

  const revert = async (error: string, status = 'draft') => {
    await supabaseAdmin
      .from('outreach_drafts')
      .update({ status, error, updated_at: new Date().toISOString() })
      .eq('id', id);
  };

  try {
    const { data: settings } = await supabaseAdmin
      .from('outreach_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (!settings) throw new Error('outreach_settings row missing — run migration 2');
    if (settings.paused) {
      await revert('outreach is paused');
      return NextResponse.json({ error: 'Outreach is paused in settings.' }, { status: 409 });
    }

    // Daily warm-up cap, counted on the IST day boundary.
    const istMs = Date.now() + 5.5 * 3600_000;
    const istMidnightUtc = new Date(Math.floor(istMs / 86_400_000) * 86_400_000 - 5.5 * 3600_000);
    const { count: sentToday } = await supabaseAdmin
      .from('outreach_drafts')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', istMidnightUtc.toISOString());
    if ((sentToday ?? 0) >= settings.daily_cap) {
      await revert('daily cap reached');
      return NextResponse.json(
        { error: `Daily cap reached (${sentToday}/${settings.daily_cap}). Try tomorrow or raise the cap.` },
        { status: 429 },
      );
    }

    const { data: contact } = await supabaseAdmin
      .from('lead_contacts')
      .select('email')
      .eq('id', draft.contact_id)
      .single();
    if (!contact) throw new Error('contact not found');

    const { data: suppressed } = await supabaseAdmin
      .from('suppressions')
      .select('email, reason')
      .eq('email', contact.email)
      .maybeSingle();
    if (suppressed) {
      await revert(`recipient suppressed (${suppressed.reason})`, 'discarded');
      return NextResponse.json(
        { error: `${contact.email} is suppressed (${suppressed.reason}).` },
        { status: 409 },
      );
    }

    const fromAddress = `${settings.from_name} <${settings.from_email}>`;
    const sendResult = await sendEmail({
      to: contact.email,
      from: fromAddress,
      subject: draft.subject,
      html: bodyToHtml(draft.body_text, settings.footer_address),
      ...(settings.reply_to ? { replyTo: settings.reply_to } : {}),
    });
    if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
    const resendId = sendResult.data?.id ?? null;

    await supabaseAdmin
      .from('outreach_drafts')
      .update({
        status: 'sent',
        resend_email_id: resendId,
        sent_at: new Date().toISOString(),
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    await supabaseAdmin
      .from('leads')
      .update({ status: 'contacted', updated_at: new Date().toISOString() })
      .eq('id', draft.lead_id);

    await supabaseAdmin.from('outreach_events').insert({
      draft_id: id,
      lead_id: draft.lead_id,
      resend_email_id: resendId,
      type: 'sent',
      payload: { to: contact.email, subject: draft.subject },
    });

    return NextResponse.json({ ok: true, sentToday: (sentToday ?? 0) + 1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await revert(msg, 'failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
