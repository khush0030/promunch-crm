import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Sequences index with steps (+ template names) and enrollment aggregates.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const [{ data: sequences, error }, { data: steps }, { data: enrollments }, { data: stepStats }] =
    await Promise.all([
      supabaseAdmin
        .from('email_sequences')
        .select('*')
        .neq('status', 'archived')
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('email_sequence_steps')
        .select('id, sequence_id, position, wait_days, template_id, email_templates(name, subject, body_text)')
        .order('position', { ascending: true }),
      supabaseAdmin.from('sequence_enrollments').select('sequence_id, status'),
      // Per-step outcomes come from the drafts each step created.
      supabaseAdmin
        .from('outreach_drafts')
        .select('enrollment_id, step_position, status, sequence_enrollments!inner(sequence_id)')
        .not('enrollment_id', 'is', null),
    ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stepsBySeq = new Map<string, unknown[]>();
  for (const s of steps ?? []) {
    const t = s.email_templates as unknown as { name: string; subject: string; body_text: string } | null;
    const list = stepsBySeq.get(s.sequence_id) ?? [];
    list.push({
      id: s.id,
      position: s.position,
      wait_days: s.wait_days,
      template_id: s.template_id,
      template_name: t?.name ?? '(missing)',
      template_subject: t?.subject ?? '',
      template_body: t?.body_text ?? '',
    });
    stepsBySeq.set(s.sequence_id, list);
  }

  const enrollAgg = new Map<string, Record<string, number>>();
  for (const e of enrollments ?? []) {
    const a = enrollAgg.get(e.sequence_id) ?? {};
    a[e.status] = (a[e.status] ?? 0) + 1;
    enrollAgg.set(e.sequence_id, a);
  }

  // sent per (sequence, step) from draft rows
  const sentByStep = new Map<string, number>();
  for (const d of stepStats ?? []) {
    if (d.status !== 'sent' && d.status !== 'replied' && d.status !== 'bounced') continue;
    const seqId = (d.sequence_enrollments as unknown as { sequence_id: string }).sequence_id;
    const key = `${seqId}:${d.step_position}`;
    sentByStep.set(key, (sentByStep.get(key) ?? 0) + 1);
  }

  return NextResponse.json({
    sequences: (sequences ?? []).map((seq) => ({
      ...seq,
      steps: (stepsBySeq.get(seq.id) ?? []).map((st) => ({
        ...(st as Record<string, unknown>),
        sent: sentByStep.get(`${seq.id}:${(st as { position: number }).position}`) ?? 0,
      })),
      enrollments: enrollAgg.get(seq.id) ?? {},
    })),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { name?: string; stop_on_reply?: boolean; ai_polish?: boolean; steps?: { template_id?: string; wait_days?: number }[] }
    | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const steps = (body?.steps ?? []).filter((s) => s.template_id);
  if (!steps.length) return NextResponse.json({ error: 'at least one step with a template is required' }, { status: 400 });

  const { data: seq, error } = await supabaseAdmin
    .from('email_sequences')
    .insert({
      name: name.slice(0, 120),
      status: 'draft',
      stop_on_reply: body?.stop_on_reply ?? true,
      ai_polish: body?.ai_polish ?? true,
    })
    .select('*')
    .single();
  if (error || !seq) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

  const { error: stepErr } = await supabaseAdmin.from('email_sequence_steps').insert(
    steps.map((s, i) => ({
      sequence_id: seq.id,
      position: i,
      template_id: s.template_id!,
      // Step 0 sends immediately on enrolment; later steps wait at least a day.
      wait_days: i === 0 ? 0 : Math.max(1, Math.floor(s.wait_days ?? 3)),
    })),
  );
  if (stepErr) {
    await supabaseAdmin.from('email_sequences').delete().eq('id', seq.id);
    return NextResponse.json({ error: stepErr.message }, { status: 500 });
  }

  return NextResponse.json({ sequence: seq });
}
