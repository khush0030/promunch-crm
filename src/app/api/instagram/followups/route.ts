import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// The follow-up approval queue (Tasks tab): nudges the engine could not send
// automatically (window closed / human-owned thread), due-first, plus recent
// escalations, plus what's scheduled next so the team can see the cadence.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const threadCols =
    'id, handle, full_name, classification, collab_stage, fit_score, followers, bio_email, phone, status, last_inbound_at, last_message_snippet';

  const [awaiting, escalated, scheduled] = await Promise.all([
    supabaseAdmin
      .from('ig_followups')
      .select(`*, thread:ig_threads(${threadCols})`)
      .eq('status', 'awaiting_approval')
      .order('next_action_at', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('ig_followups')
      .select(`*, thread:ig_threads(${threadCols})`)
      .eq('status', 'escalated')
      .gte('updated_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('ig_followups')
      .select(`id, thread_id, stage, step, next_action_at, thread:ig_threads(${threadCols})`)
      .eq('status', 'scheduled')
      .order('next_action_at', { ascending: true })
      .limit(50),
  ]);

  const err = awaiting.error ?? escalated.error ?? scheduled.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  return NextResponse.json({
    awaiting: awaiting.data ?? [],
    escalated: escalated.data ?? [],
    scheduled: scheduled.data ?? [],
    counts: { awaiting: awaiting.data?.length ?? 0 },
  });
}
