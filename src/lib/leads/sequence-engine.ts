// Sequence send stage — runs inside the pipeline tick. Picks due enrollments,
// renders the step's template for the lead, optionally AI-polishes the opening
// line, and sends through the SAME outreach_drafts + Resend path as manual
// sends, so webhooks/replies/bounces/suppressions/history need zero changes.
//
// Concurrency: compare-and-set claim (active -> sending) per enrollment, the
// same principle as claimLead(); overlapping ticks can never double-send.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/resend';
import { bodyToHtml } from './draft';
import { renderTemplate } from './templates';
import { polishOpening } from './template-ai';
import { inSendWindow, istMidnightUtc, nextSendAt } from './schedule';
import type { Enrichment } from '@/components/leads/types';

const SEQUENCE_BATCH = 5;

export interface SequenceSummary {
  sequenceSent: number;
  errors: string[];
}

type EnrollmentRow = {
  id: string;
  sequence_id: string;
  lead_id: string;
  contact_id: string;
  current_step: number;
};

type StepRow = { position: number; wait_days: number; template_id: string };

export async function processSequences(summary: SequenceSummary): Promise<void> {
  const now = new Date();

  const { data: settings } = await supabaseAdmin
    .from('outreach_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (!settings || settings.paused) return;

  const windowStart = (settings.send_window_start as number | null) ?? 9;
  const windowEnd = (settings.send_window_end as number | null) ?? 18;
  if (!inSendWindow(now, windowStart, windowEnd)) return;

  // Shared IST daily cap across manual + sequence sends.
  const { count: sentToday } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', istMidnightUtc(now).toISOString());
  const remaining = (settings.daily_cap as number) - (sentToday ?? 0);
  if (remaining <= 0) return;

  const { data: due } = await supabaseAdmin
    .from('sequence_enrollments')
    .select('id, sequence_id, lead_id, contact_id, current_step')
    .eq('status', 'active')
    .lte('next_send_at', now.toISOString())
    .order('next_send_at', { ascending: true })
    .limit(Math.min(remaining, SEQUENCE_BATCH));

  for (const enrollment of (due ?? []) as EnrollmentRow[]) {
    if (!(await claimEnrollment(enrollment.id))) continue;
    try {
      await sendStep(enrollment, settings, windowStart, windowEnd, summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.errors.push(`sequence ${enrollment.id}: ${msg}`);
      // Back to active with the error; next tick retries (next_send_at unchanged).
      await supabaseAdmin
        .from('sequence_enrollments')
        .update({ status: 'active', error: msg, updated_at: new Date().toISOString() })
        .eq('id', enrollment.id);
    }
  }
}

async function claimEnrollment(id: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('sequence_enrollments')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'active')
    .select('id');
  return (data?.length ?? 0) > 0;
}

async function terminate(enrollmentId: string, status: string, error: string | null = null) {
  await supabaseAdmin
    .from('sequence_enrollments')
    .update({ status, error, updated_at: new Date().toISOString() })
    .eq('id', enrollmentId);
}

async function sendStep(
  enrollment: EnrollmentRow,
  settings: Record<string, unknown>,
  windowStart: number,
  windowEnd: number,
  summary: SequenceSummary,
) {
  const now = new Date();

  const [{ data: sequence }, { data: steps }, { data: lead }, { data: contact }] = await Promise.all([
    supabaseAdmin
      .from('email_sequences')
      .select('id, status, stop_on_reply, ai_polish')
      .eq('id', enrollment.sequence_id)
      .maybeSingle(),
    supabaseAdmin
      .from('email_sequence_steps')
      .select('position, wait_days, template_id')
      .eq('sequence_id', enrollment.sequence_id)
      .order('position', { ascending: true }),
    supabaseAdmin
      .from('leads')
      .select('id, name, city, category, status, site_snippet, enrichment')
      .eq('id', enrollment.lead_id)
      .maybeSingle(),
    supabaseAdmin
      .from('lead_contacts')
      .select('id, email, role_hint, verify_status')
      .eq('id', enrollment.contact_id)
      .maybeSingle(),
  ]);

  if (!sequence || sequence.status !== 'active') {
    // Paused/archived sequence: put the enrollment back untouched; it resumes
    // when the sequence is reactivated.
    await supabaseAdmin
      .from('sequence_enrollments')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    return;
  }
  if (!lead || !contact) return terminate(enrollment.id, 'stopped', 'lead or contact missing');

  // Auto-stop: never keep mailing someone who replied, bounced, or was suppressed.
  if (lead.status === 'replied' && sequence.stop_on_reply) return terminate(enrollment.id, 'replied');
  if (lead.status === 'bounced') return terminate(enrollment.id, 'bounced');
  if (lead.status === 'suppressed') return terminate(enrollment.id, 'stopped', 'lead suppressed');

  const { data: suppressed } = await supabaseAdmin
    .from('suppressions')
    .select('email, reason')
    .eq('email', contact.email)
    .maybeSingle();
  if (suppressed) return terminate(enrollment.id, 'stopped', `recipient suppressed (${suppressed.reason})`);

  const stepList = (steps ?? []) as StepRow[];
  const step = stepList.find((s) => s.position === enrollment.current_step);
  if (!step) return terminate(enrollment.id, 'completed');

  const { data: template } = await supabaseAdmin
    .from('email_templates')
    .select('id, subject, body_text')
    .eq('id', step.template_id)
    .maybeSingle();
  if (!template) return terminate(enrollment.id, 'stopped', 'template missing');

  const vars = {
    name: contact.role_hint,
    company: lead.name as string,
    city: lead.city as string | null,
    category: lead.category as string | null,
  };
  const subject = renderTemplate(template.subject as string, vars);
  let body = renderTemplate(template.body_text as string, vars);
  if (sequence.ai_polish) {
    body = await polishOpening({
      body,
      lead: {
        name: lead.name as string,
        category: lead.category as string | null,
        city: lead.city as string | null,
        site_snippet: lead.site_snippet as string | null,
        enrichment: (lead.enrichment as Enrichment | null) ?? null,
      },
    });
  }

  // Record the send as a draft row FIRST so a crash between send and record
  // leaves evidence ('sending' row) instead of an untracked email.
  const { data: draftRow, error: draftErr } = await supabaseAdmin
    .from('outreach_drafts')
    .insert({
      lead_id: lead.id,
      contact_id: contact.id,
      subject,
      body_text: body,
      model: 'template',
      status: 'sending',
      enrollment_id: enrollment.id,
      step_position: step.position,
      approved_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (draftErr || !draftRow) throw new Error(`draft insert: ${draftErr?.message ?? 'no row'}`);

  const fromAddress = `${settings.from_name} <${settings.from_email}>`;
  const sendResult = await sendEmail({
    to: contact.email,
    from: fromAddress,
    subject,
    html: bodyToHtml(body, settings.footer_address as string),
    ...(settings.reply_to ? { replyTo: settings.reply_to as string } : {}),
  });
  if (sendResult.error) {
    await supabaseAdmin
      .from('outreach_drafts')
      .update({ status: 'failed', error: sendResult.error.message, updated_at: new Date().toISOString() })
      .eq('id', draftRow.id);
    throw new Error(`Resend: ${sendResult.error.message}`);
  }
  const resendId = sendResult.data?.id ?? null;

  await Promise.all([
    supabaseAdmin
      .from('outreach_drafts')
      .update({
        status: 'sent',
        resend_email_id: resendId,
        sent_at: now.toISOString(),
        error: null,
        updated_at: now.toISOString(),
      })
      .eq('id', draftRow.id),
    supabaseAdmin
      .from('leads')
      .update({ status: 'contacted', updated_at: now.toISOString() })
      .eq('id', lead.id),
    supabaseAdmin.from('outreach_events').insert({
      draft_id: draftRow.id,
      lead_id: lead.id,
      resend_email_id: resendId,
      type: 'sent',
      payload: { to: contact.email, subject, sequence_id: enrollment.sequence_id, step: step.position },
    }),
  ]);

  // Advance to the next step or finish.
  const next = stepList.find((s) => s.position === enrollment.current_step + 1);
  await supabaseAdmin
    .from('sequence_enrollments')
    .update({
      status: next ? 'active' : 'completed',
      current_step: enrollment.current_step + 1,
      last_sent_at: now.toISOString(),
      next_send_at: next ? nextSendAt(now, next.wait_days, windowStart, windowEnd).toISOString() : null,
      error: null,
      updated_at: now.toISOString(),
    })
    .eq('id', enrollment.id);

  summary.sequenceSent++;
}

/** Reply/bounce hooks (called from the Resend webhooks): stop active enrollments. */
export async function stopEnrollmentsForLead(leadId: string, terminal: 'replied' | 'bounced' | 'stopped') {
  // stop_on_reply=false sequences keep going on a reply; bounces always stop.
  const { data: enrollments } = await supabaseAdmin
    .from('sequence_enrollments')
    .select('id, sequence_id, email_sequences(stop_on_reply)')
    .eq('lead_id', leadId)
    .in('status', ['active', 'sending']);
  for (const e of enrollments ?? []) {
    const seq = e.email_sequences as unknown as { stop_on_reply: boolean } | null;
    if (terminal === 'replied' && seq && !seq.stop_on_reply) continue;
    await supabaseAdmin
      .from('sequence_enrollments')
      .update({ status: terminal, updated_at: new Date().toISOString() })
      .eq('id', e.id);
  }
}
