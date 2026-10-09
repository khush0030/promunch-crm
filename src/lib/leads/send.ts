// The ONE send path for B2B outreach (first emails and follow-ups).
//
// Never email a business twice:
//   1. claimSend() moves a draft to 'sending' through the b2b_claim_send RPC
//      (migration 20261010110000): one advisory-locked transaction that checks
//      pause, the IST daily cap (in-flight sends count), suppression, closed
//      leads, and "this address / this website was already emailed". Two
//      callers can never both claim, and never both squeeze under the cap.
//   2. Only the caller that claimed the row calls Resend (deliverClaimed).
//   3. Partial unique indexes allow one first email per lead and one send per
//      follow-up step, so even a code bug cannot insert a second one.
// When in doubt we do not send: any unexpected state leaves the draft unsent.
//
// Before the migration is applied the RPC is missing; claimSend falls back to
// the previous compare-and-set claim plus JS checks (still exactly one sender
// per draft; the cap check is then best-effort).

import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/resend';
import { bodyToHtml } from './draft';
import { isMissingSchema, istDayStart } from './db';
import { nextSendAt } from './schedule';
import { CLOSED_STATUSES } from './lead-status';

export type ClaimOutcome =
  | 'claimed' | 'not_found' | 'not_sendable' | 'paused' | 'cap' | 'no_contact'
  | 'suppressed' | 'lead_closed' | 'already_emailed' | 'no_settings' | 'error';

export interface ClaimResult {
  outcome: ClaimOutcome;
  used?: number;
  cap?: number;
  why?: string;
  status?: string;
  message?: string;
}

export const CLAIM_MESSAGE: Record<ClaimOutcome, string> = {
  claimed: 'Sending.',
  not_found: 'That email no longer exists.',
  not_sendable: 'That email was already sent or removed.',
  paused: 'Sending is paused in Settings.',
  cap: "Today's sending limit is reached. It goes out tomorrow.",
  no_contact: 'This business has no email address.',
  suppressed: 'This address asked not to be emailed, or bounced before.',
  lead_closed: 'This business replied, bounced or was marked not interested.',
  already_emailed: 'This business was already emailed, so it is not emailed again.',
  no_settings: 'Outreach settings are missing.',
  error: 'Could not send.',
};

const IN_FLIGHT_MS = 15 * 60_000;

export async function claimSend(draftId: string, from: string[]): Promise<ClaimResult> {
  const { data, error } = await supabaseAdmin.rpc('b2b_claim_send', { p_draft_id: draftId, p_from: from });
  if (!error && data) return data as ClaimResult;
  if (error && !isMissingSchema(error)) return { outcome: 'error', message: error.message };
  return claimSendFallback(draftId, from);
}

async function claimSendFallback(draftId: string, from: string[]): Promise<ClaimResult> {
  const { data: settings } = await supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle();
  if (!settings) return { outcome: 'no_settings' };
  if (settings.paused) return { outcome: 'paused' };

  const { count: used } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id', { count: 'exact', head: true })
    .or(`sent_at.gte.${istDayStart().toISOString()},and(status.eq.sending,updated_at.gt.${new Date(Date.now() - IN_FLIGHT_MS).toISOString()})`);
  if ((used ?? 0) >= (settings.daily_cap as number)) return { outcome: 'cap', used: used ?? 0, cap: settings.daily_cap as number };

  const { data: draft } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id, lead_id, contact_id, status, enrollment_id')
    .eq('id', draftId)
    .maybeSingle();
  if (!draft) return { outcome: 'not_found' };
  if (!from.includes(draft.status as string)) return { outcome: 'not_sendable', status: draft.status as string };

  const [{ data: contact }, { data: lead }] = await Promise.all([
    supabaseAdmin.from('lead_contacts').select('email').eq('id', draft.contact_id).maybeSingle(),
    supabaseAdmin.from('leads').select('status').eq('id', draft.lead_id).maybeSingle(),
  ]);
  const email = (contact?.email as string | undefined)?.toLowerCase();
  if (!email) return { outcome: 'no_contact' };
  const { data: suppressed } = await supabaseAdmin.from('suppressions').select('email').eq('email', email).maybeSingle();
  if (suppressed) return { outcome: 'suppressed' };
  if ((CLOSED_STATUSES as string[]).includes(lead?.status as string)) return { outcome: 'lead_closed' };

  if (!draft.enrollment_id) {
    const { data: prior } = await supabaseAdmin
      .from('outreach_drafts')
      .select('id, lead_contacts!inner(email)')
      .neq('id', draftId)
      .in('status', ['sending', 'sent', 'replied', 'bounced'])
      .ilike('lead_contacts.email', email)
      .limit(1);
    if (prior?.length) return { outcome: 'already_emailed', why: 'address' };
  }

  // Compare-and-set: only one caller moves the row out of `from`.
  const { data: claimed } = await supabaseAdmin
    .from('outreach_drafts')
    .update({ status: 'sending', approved_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .in('status', from)
    .select('id');
  if (!claimed?.length) return { outcome: 'not_sendable' };
  return { outcome: 'claimed', used: (used ?? 0) + 1, cap: settings.daily_cap as number };
}

/**
 * Deliver a draft this caller has claimed ('sending'). Records the result.
 * Returns the Resend id on success. Never retries: a failure leaves the draft
 * 'failed' for a person to look at.
 */
export async function deliverClaimed(
  draftId: string,
): Promise<{ ok: true; resendId: string | null } | { ok: false; error: string; unknown?: boolean }> {
  const { data: draft } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id, lead_id, contact_id, subject, body_text, status, enrollment_id, step_position')
    .eq('id', draftId)
    .maybeSingle();
  if (!draft || draft.status !== 'sending') return { ok: false, error: 'draft is not claimed for sending' };

  const [{ data: settings }, { data: contact }] = await Promise.all([
    supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle(),
    supabaseAdmin.from('lead_contacts').select('email').eq('id', draft.contact_id).maybeSingle(),
  ]);
  const fail = async (error: string) => {
    await supabaseAdmin
      .from('outreach_drafts')
      .update({ status: 'failed', error, updated_at: new Date().toISOString() })
      .eq('id', draftId)
      .eq('status', 'sending');
    return { ok: false as const, error };
  };
  if (!settings) return fail('outreach settings missing');
  if (!contact?.email) return fail('contact missing');

  let resendId: string | null = null;
  try {
    const result = await sendEmail({
      to: contact.email as string,
      from: `${settings.from_name} <${settings.from_email}>`,
      subject: draft.subject as string,
      html: bodyToHtml(draft.body_text as string, settings.footer_address as string),
      ...(settings.reply_to ? { replyTo: settings.reply_to as string } : {}),
    });
    if (result.error) return fail(`Resend: ${result.error.message}`);
    resendId = result.data?.id ?? null;
  } catch (e) {
    // Unknown whether Resend accepted it. Do NOT mark failed (a retry could
    // send twice); leave it 'sending' as evidence. It counts as emailed.
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from('outreach_drafts')
      .update({ error: `send outcome unknown: ${msg}`, updated_at: new Date().toISOString() })
      .eq('id', draftId);
    return { ok: false, error: msg, unknown: true };
  }

  const now = new Date().toISOString();
  await Promise.all([
    supabaseAdmin
      .from('outreach_drafts')
      .update({ status: 'sent', resend_email_id: resendId, sent_at: now, error: null, updated_at: now })
      .eq('id', draftId),
    supabaseAdmin.from('outreach_events').insert({
      draft_id: draftId,
      lead_id: draft.lead_id,
      resend_email_id: resendId,
      type: 'sent',
      payload: {
        to: contact.email,
        subject: draft.subject,
        ...(draft.enrollment_id ? { enrollment_id: draft.enrollment_id, step: draft.step_position } : {}),
      },
    }),
  ]);
  return { ok: true, resendId };
}

export type FirstSendResult =
  | { ok: true; used?: number; cap?: number }
  | { ok: false; outcome: ClaimOutcome | 'send_failed'; message: string };

/**
 * Send one FIRST email (approved queue, or an explicit "Send now").
 * Handles every claim outcome so a refused draft never lingers in a state
 * that could be retried into a second email.
 */
export async function sendFirstEmail(draftId: string, from: string[] = ['approved']): Promise<FirstSendResult> {
  const claim = await claimSend(draftId, from);
  if (claim.outcome !== 'claimed') {
    await settleRefusal(draftId, claim);
    return { ok: false, outcome: claim.outcome, message: claim.message ?? CLAIM_MESSAGE[claim.outcome] };
  }

  const sent = await deliverClaimed(draftId);
  const { data: draft } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id, lead_id, contact_id, batch_id')
    .eq('id', draftId)
    .maybeSingle();

  if (!sent.ok) {
    if (sent.unknown && draft) {
      // Resend may have accepted it: treat as emailed so nothing resends it.
      await supabaseAdmin
        .from('leads')
        .update({ status: 'contacted', error: `send outcome unknown: ${sent.error}`, updated_at: new Date().toISOString() })
        .eq('id', draft.lead_id)
        .eq('status', 'approved');
      return { ok: false, outcome: 'send_failed', message: sent.error };
    }
    // Back to the Approve queue with the reason, so a person decides.
    if (draft) {
      await supabaseAdmin
        .from('leads')
        .update({ status: 'drafted', error: sent.error, updated_at: new Date().toISOString() })
        .eq('id', draft.lead_id)
        .eq('status', 'approved');
    }
    return { ok: false, outcome: 'send_failed', message: sent.error };
  }

  if (draft) {
    await supabaseAdmin
      .from('leads')
      .update({ status: 'contacted', error: null, updated_at: new Date().toISOString() })
      .eq('id', draft.lead_id)
      .not('status', 'in', '(replied,bounced,suppressed)');
    try {
      await enrollFollowUps(draft as { lead_id: string; contact_id: string; batch_id?: string | null });
    } catch (e) {
      console.warn('[b2b] follow-up enrol failed (email already sent):', e);
    }
  }
  return { ok: true, used: claim.used, cap: claim.cap };
}

async function settleRefusal(draftId: string, claim: ClaimResult) {
  const now = new Date().toISOString();
  const { data: draft } = await supabaseAdmin.from('outreach_drafts').select('lead_id, status').eq('id', draftId).maybeSingle();
  if (!draft) return;
  const unsent = ['draft', 'approved', 'failed'];
  if (claim.outcome === 'suppressed') {
    await supabaseAdmin.from('outreach_drafts').update({ status: 'discarded', error: CLAIM_MESSAGE.suppressed, updated_at: now }).eq('id', draftId).in('status', unsent);
    await supabaseAdmin.from('leads').update({ status: 'suppressed', updated_at: now }).eq('id', draft.lead_id).in('status', ['drafted', 'approved', 'ready']);
  } else if (claim.outcome === 'already_emailed' || claim.outcome === 'lead_closed' || claim.outcome === 'no_contact') {
    await supabaseAdmin.from('outreach_drafts').update({ status: 'discarded', error: CLAIM_MESSAGE[claim.outcome], updated_at: now }).eq('id', draftId).in('status', unsent);
    if (claim.outcome !== 'lead_closed') {
      await supabaseAdmin
        .from('leads')
        .update({ status: 'skipped', error: CLAIM_MESSAGE[claim.outcome], updated_at: now })
        .eq('id', draft.lead_id)
        .in('status', ['drafted', 'approved', 'ready']);
    }
  }
  // paused / cap / not_sendable / error: leave everything as is (approved stays
  // queued and goes out when allowed).
}

// ---------------------------------------------------------------- follow-ups --

/** After a first email is sent: enrol the lead in its batch's hidden follow-up sequence. */
export async function enrollFollowUps(draft: { lead_id: string; contact_id: string; batch_id?: string | null }) {
  if (!draft.batch_id) return;
  const { data: batch, error } = await supabaseAdmin
    .from('outreach_batches')
    .select('id, list_id, sequence_id, follow_up_count, follow_up_days')
    .eq('id', draft.batch_id)
    .maybeSingle();
  if (error || !batch || !batch.sequence_id || !batch.follow_up_count) return;

  const { data: settings } = await supabaseAdmin
    .from('outreach_settings')
    .select('send_window_start, send_window_end')
    .eq('id', 1)
    .maybeSingle();
  const first = nextSendAt(
    new Date(),
    batch.follow_up_days as number,
    (settings?.send_window_start as number | null) ?? 9,
    (settings?.send_window_end as number | null) ?? 18,
  );
  await supabaseAdmin.from('sequence_enrollments').upsert(
    {
      sequence_id: batch.sequence_id,
      lead_id: draft.lead_id,
      contact_id: draft.contact_id,
      list_id: batch.list_id,
      status: 'active',
      current_step: 1, // step 0 is the approved first email that just went out
      next_send_at: first.toISOString(),
    },
    { onConflict: 'sequence_id,lead_id', ignoreDuplicates: true },
  );
}

// Fixed, plain follow-up copy (no product claims, so nothing to ground; the
// first email carries the KB-grounded pitch). No em dashes, PROMUNCH in caps,
// signed as Parth.
export const FOLLOW_UP_COPY = [
  {
    subject: 'Following up',
    body: `Hi,

Just bringing my note from a few days ago back to the top of your inbox. I would be happy to send a free PROMUNCH sample box to {company} so your team can taste it first.

Would that be useful?

Parth
Founder, PROMUNCH

Reply "no thanks" and I won't write again.`,
  },
  {
    subject: 'One last note',
    body: `Hi,

One last note from me. If healthy snacking is not a priority for {company} right now, no problem at all. If it is, I would love to send a free PROMUNCH sample box and set up a quick 15 minute call.

Parth
Founder, PROMUNCH

Reply "no thanks" and I won't write again.`,
  },
];

/**
 * Create the hidden sequence (and its hidden templates) for a batch that wants
 * follow-ups. Returns the sequence id, or null when the migration is missing.
 */
export async function createFollowUpSequence(batchId: string, count: number, days: number): Promise<string | null> {
  const n = Math.max(0, Math.min(2, Math.floor(count)));
  if (!n) return null;
  const { data: seq, error } = await supabaseAdmin
    .from('email_sequences')
    .insert({ name: `Follow-ups for batch ${batchId.slice(0, 8)}`, status: 'active', stop_on_reply: true, ai_polish: false, internal: true })
    .select('id')
    .single();
  if (error || !seq) {
    if (isMissingSchema(error)) return null;
    throw new Error(`follow-up setup: ${error?.message ?? 'no row'}`);
  }
  for (let i = 0; i < n; i++) {
    const copy = FOLLOW_UP_COPY[i];
    const { data: tpl, error: tErr } = await supabaseAdmin
      .from('email_templates')
      .insert({ name: `Follow-up ${i + 1} (automatic)`, subject: copy.subject, body_text: copy.body, internal: true })
      .select('id')
      .single();
    if (tErr || !tpl) throw new Error(`follow-up template: ${tErr?.message ?? 'no row'}`);
    const { error: sErr } = await supabaseAdmin
      .from('email_sequence_steps')
      .insert({ sequence_id: seq.id, position: i + 1, template_id: tpl.id, wait_days: days });
    if (sErr) throw new Error(`follow-up step: ${sErr.message}`);
  }
  await supabaseAdmin.from('outreach_batches').update({ sequence_id: seq.id }).eq('id', batchId);
  return seq.id as string;
}
