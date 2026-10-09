// Sequence send stage — runs inside the pipeline tick. Picks due enrollments,
// renders the step's template for the lead, optionally AI-polishes the opening
// line, and sends through the SAME outreach_drafts + Resend path as manual
// sends, so webhooks/replies/bounces/suppressions/history need zero changes.
//
// Concurrency: compare-and-set claim (active -> sending) per enrollment, then
// the step's draft row (unique per enrollment+step, migration 20261010110000)
// and the shared atomic send claim b2b_claim_send (cap, pause, suppression,
// closed lead). Overlapping ticks can never double-send.
//
// Two kinds of sequence run here:
//   - internal: the hidden follow-ups of a "Write emails" batch (one-path
//     flow). Step 0 is the approved first email; steps 1..2 are follow-ups,
//     sent as "Re: <first subject>".
//   - legacy: older user-built sequences ("Email this list", removed from the
//     UI). Existing enrollments finish safely; a legacy FIRST email is skipped
//     when the business was already emailed or has an email in the Approve
//     queue, so no business is ever in both paths.

import { supabaseAdmin } from '@/lib/supabase-admin';
import { renderTemplate } from './templates';
import { polishOpening } from './template-ai';
import { inSendWindow, istMidnightUtc, nextSendAt } from './schedule';
import { claimSend, deliverClaimed } from './send';
import { isMissingSchema } from './db';
import type { Enrichment } from '@/components/leads/types';

const SEQUENCE_BATCH = 5;
const MAX_STEP_FAILURES = 2;

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
    loadSequence(enrollment.sequence_id),
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
  if (lead.status === 'skipped') return terminate(enrollment.id, 'stopped', 'marked not interested');

  // A reply always ends follow-ups, even if the inbound webhook could not
  // flip the lead status (e.g. the same address on two businesses).
  if (sequence.internal || sequence.stop_on_reply) {
    const { count: replies } = await supabaseAdmin
      .from('outreach_replies')
      .select('id', { count: 'exact', head: true })
      .or(`lead_id.eq.${lead.id},from_email.ilike.${(contact.email as string).replace(/[,()]/g, '')}`);
    if ((replies ?? 0) > 0) return terminate(enrollment.id, 'replied');
  }

  // Never in both paths: a legacy sequence's FIRST email is skipped when the
  // business was already emailed or has an email in the one-path queue.
  if (!sequence.internal && enrollment.current_step === 0) {
    const { data: other } = await supabaseAdmin
      .from('outreach_drafts')
      .select('id, status, enrollment_id')
      .eq('lead_id', lead.id)
      .in('status', ['draft', 'approved', 'sending', 'sent', 'replied', 'bounced'])
      .limit(5);
    if ((other ?? []).some((d) => d.enrollment_id !== enrollment.id)) {
      return terminate(enrollment.id, 'stopped', 'already emailed or waiting for approval');
    }
  }
  // Internal follow-ups only go to businesses whose first email went out.
  if (sequence.internal && lead.status !== 'contacted') {
    return terminate(enrollment.id, 'stopped', `lead is ${lead.status}`);
  }

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
    name: sequence.internal ? null : contact.role_hint,
    company: lead.name as string,
    city: lead.city as string | null,
    category: lead.category as string | null,
  };
  let subject = renderTemplate(template.subject as string, vars);
  let body = renderTemplate(template.body_text as string, vars);
  if (sequence.internal) {
    // Follow-ups read as replies to the first email.
    const { data: first } = await supabaseAdmin
      .from('outreach_drafts')
      .select('subject')
      .eq('lead_id', lead.id)
      .is('enrollment_id', null)
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (first?.subject) subject = `Re: ${String(first.subject).replace(/^re:\s*/i, '')}`;
  } else if (sequence.ai_polish) {
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

  // Too many failed tries on this step: stop rather than keep retrying.
  const { count: failures } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('enrollment_id', enrollment.id)
    .eq('step_position', step.position)
    .eq('status', 'failed');
  if ((failures ?? 0) >= MAX_STEP_FAILURES) return terminate(enrollment.id, 'stopped', 'sending failed twice');

  // The step's draft row first (unique per enrollment+step), then the shared
  // atomic claim. A crash after this leaves evidence, never an untracked email.
  const { data: draftRow, error: draftErr } = await supabaseAdmin
    .from('outreach_drafts')
    .insert({
      lead_id: lead.id,
      contact_id: contact.id,
      subject,
      body_text: body,
      model: 'template',
      status: 'approved',
      enrollment_id: enrollment.id,
      step_position: step.position,
      approved_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (draftErr?.code === '23505') {
    // This step already has a send on record: never send it again, move on.
    await advance(enrollment, stepList, now, windowStart, windowEnd);
    return;
  }
  if (draftErr || !draftRow) throw new Error(`draft insert: ${draftErr?.message ?? 'no row'}`);

  const claim = await claimSend(draftRow.id as string, ['approved']);
  if (claim.outcome !== 'claimed') {
    await supabaseAdmin.from('outreach_drafts').delete().eq('id', draftRow.id).eq('status', 'approved');
    if (claim.outcome === 'suppressed') return terminate(enrollment.id, 'stopped', 'recipient suppressed');
    if (claim.outcome === 'lead_closed') return terminate(enrollment.id, 'stopped', 'lead closed');
    if (claim.outcome === 'no_contact') return terminate(enrollment.id, 'stopped', 'contact missing');
    // paused / cap / transient: back to active, try again on a later tick.
    await supabaseAdmin
      .from('sequence_enrollments')
      .update({ status: 'active', error: claim.outcome === 'error' ? claim.message ?? 'claim failed' : null, updated_at: new Date().toISOString() })
      .eq('id', enrollment.id);
    return;
  }

  const sent = await deliverClaimed(draftRow.id as string);
  if (!sent.ok && !sent.unknown) throw new Error(sent.error);

  await supabaseAdmin
    .from('leads')
    .update({ status: 'contacted', updated_at: now.toISOString() })
    .eq('id', lead.id)
    .not('status', 'in', '(replied,bounced,suppressed,skipped)');

  await advance(enrollment, stepList, now, windowStart, windowEnd);
  summary.sequenceSent++;
}

async function advance(enrollment: EnrollmentRow, stepList: StepRow[], now: Date, windowStart: number, windowEnd: number) {
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
}

type SequenceInfo = { id: string; status: string; stop_on_reply: boolean; ai_polish: boolean; internal: boolean };

async function loadSequence(id: string): Promise<{ data: SequenceInfo | null }> {
  const res = await supabaseAdmin
    .from('email_sequences')
    .select('id, status, stop_on_reply, ai_polish, internal')
    .eq('id', id)
    .maybeSingle();
  if (!res.error) return { data: res.data as SequenceInfo | null };
  if (!isMissingSchema(res.error)) throw new Error(res.error.message);
  const old = await supabaseAdmin
    .from('email_sequences')
    .select('id, status, stop_on_reply, ai_polish')
    .eq('id', id)
    .maybeSingle();
  return { data: old.data ? ({ ...(old.data as Omit<SequenceInfo, 'internal'>), internal: false }) : null };
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
