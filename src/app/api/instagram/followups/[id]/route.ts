import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { sendEmail } from '@/lib/resend';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Act on a queued follow-up (Tasks tab):
//   { action: 'edit', draft }                     — tweak the message
//   { action: 'skip' }                            — cancel this nudge
//   { action: 'approve', draft?, channel? }       — send it now:
//       ig_dm            → ig-send as the session user (window open)
//       ig_dm_human_agent→ ig-send as the session user (HUMAN_AGENT 7d lane)
//       email            → Resend to the thread's bio email (suppressions honored)
//       whatsapp/manual  — the human sent it from the IG app / WhatsApp
//                          themselves; we record it and advance the cadence
// Approving marks the row sent and schedules the next cadence step, exactly
// like the tick's auto-send path.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  const { data: f } = await supabaseAdmin.from('ig_followups').select('*').eq('id', id).maybeSingle();
  if (!f) return NextResponse.json({ error: 'follow-up not found' }, { status: 404 });

  if (action === 'edit') {
    const draft = (body.draft ?? '').toString().trim();
    if (!draft) return NextResponse.json({ error: 'draft required' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('ig_followups')
      .update({ draft, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, followup: data });
  }

  if (action === 'skip') {
    const { error } = await supabaseAdmin
      .from('ig_followups')
      .update({
        status: 'cancelled',
        claimed_at: null,
        meta: { ...(f.meta ?? {}), cancelled_reason: 'skipped' },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['awaiting_approval', 'scheduled', 'escalated']);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action !== 'approve') return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  if (f.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `follow-up is ${f.status}, not awaiting approval` }, { status: 409 });
  }

  const draft = ((body.draft ?? f.draft) ?? '').toString().trim();
  if (!draft) return NextResponse.json({ error: 'no draft to send' }, { status: 400 });
  const channel = (body.channel ?? f.channel ?? 'manual').toString();

  const { data: thread } = await supabaseAdmin.from('ig_threads').select('*').eq('id', f.thread_id).maybeSingle();
  if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const approver = user?.email ?? 'dashboard';

  // ---- atomic claim: only one approver wins this row ----
  const { data: won } = await supabaseAdmin
    .from('ig_followups')
    .update({ status: 'sending', claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'awaiting_approval')
    .select('id');
  if (!won?.length) return NextResponse.json({ error: 'already being handled' }, { status: 409 });

  const revert = async (error: string) => {
    await supabaseAdmin
      .from('ig_followups')
      .update({ status: 'awaiting_approval', claimed_at: null, last_error: error.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'sending');
  };

  try {
    if (channel === 'ig_dm' || channel === 'ig_dm_human_agent') {
      // human-approved DM through the single send chokepoint; ig-send applies
      // the HUMAN_AGENT tag itself when the thread is in the 7-day lane
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ig-send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: f.thread_id,
          kind: 'text',
          text: draft,
          sent_by: approver,
          ai_generated: true,
          ai_meta: { followup_id: f.id, step: f.step, stage: f.stage, approved_by: approver },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        await revert(data.error ?? `ig-send HTTP ${res.status}`);
        return NextResponse.json({ error: data.error ?? 'send failed' }, { status: 502 });
      }
    } else if (channel === 'email') {
      if (!thread.bio_email) {
        await revert('thread has no bio email');
        return NextResponse.json({ error: 'thread has no bio email' }, { status: 400 });
      }
      const { data: suppressed } = await supabaseAdmin
        .from('suppressions')
        .select('email, reason')
        .eq('email', thread.bio_email)
        .maybeSingle();
      if (suppressed) {
        await revert(`suppressed (${suppressed.reason})`);
        return NextResponse.json({ error: `${thread.bio_email} is suppressed (${suppressed.reason})` }, { status: 409 });
      }
      const html = draft.split(/\n{2,}/).map((p: string) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
      const sendResult = await sendEmail({
        to: thread.bio_email,
        subject: `Following up on our PROMUNCH collab${thread.handle ? `, @${thread.handle}` : ''}`,
        html,
      });
      if (sendResult.error) {
        await revert(`Resend: ${sendResult.error.message}`);
        return NextResponse.json({ error: `Resend: ${sendResult.error.message}` }, { status: 502 });
      }
      await recordOutbound(f, thread, 'email', draft, approver);
    } else {
      // whatsapp / manual — the human sent it themselves (wa.me link / IG app);
      // record it in the ledger so the timeline and the quiet clock are truthful
      await recordOutbound(f, thread, channel === 'whatsapp' ? 'whatsapp' : 'dm', draft, approver, channel);
    }

    await supabaseAdmin
      .from('ig_followups')
      .update({ status: 'sent', channel, draft, claimed_at: null, last_error: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    await scheduleNextStep(f);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await revert(msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Ledger + thread-clock update for sends that do not go through ig-send.
async function recordOutbound(
  f: { id: string; thread_id: string; step: number; stage: string },
  thread: { id: string },
  kind: string,
  text: string,
  approver: string,
  via?: string,
) {
  await supabaseAdmin.from('ig_messages').insert({
    thread_id: f.thread_id,
    direction: 'outbound',
    kind,
    text,
    status: 'sent',
    sent_by: approver,
    ai_generated: true,
    ai_meta: { followup_id: f.id, step: f.step, stage: f.stage, ...(via ? { via } : {}) },
  });
  await supabaseAdmin.from('ig_threads').update({
    last_outbound_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    last_message_snippet: text.slice(0, 240),
    updated_at: new Date().toISOString(),
  }).eq('id', thread.id);
}

// Mirror of the tick's scheduleNext: arm the next cadence step, if any.
async function scheduleNextStep(f: { thread_id: string; stage: string; step: number }) {
  const { data: settings } = await supabaseAdmin
    .from('ig_settings')
    .select('followup_cadences')
    .eq('id', 1)
    .maybeSingle();
  const cadence = (settings?.followup_cadences as Record<string, { days?: number[] }> | null)?.[f.stage];
  const days = Array.isArray(cadence?.days) ? cadence.days.map(Number) : [];
  if (f.step >= days.length) return;
  const deltaDays = Math.max(1, days[f.step] - days[f.step - 1]);
  const { error } = await supabaseAdmin.from('ig_followups').insert({
    thread_id: f.thread_id,
    stage: f.stage,
    step: f.step + 1,
    status: 'scheduled',
    next_action_at: new Date(Date.now() + deltaDays * 86_400_000).toISOString(),
  });
  if (error && error.code !== '23505') console.error('[ig followups] scheduleNext failed', error.message);
}
