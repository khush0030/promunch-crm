import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as
    | {
        name?: string;
        status?: 'draft' | 'active' | 'paused' | 'archived';
        stop_on_reply?: boolean;
        ai_polish?: boolean;
        steps?: { template_id?: string; wait_days?: number }[];
      }
    | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.name?.trim()) patch.name = body.name.trim().slice(0, 120);
  if (body.status && ['draft', 'active', 'paused', 'archived'].includes(body.status)) patch.status = body.status;
  if (typeof body.stop_on_reply === 'boolean') patch.stop_on_reply = body.stop_on_reply;
  if (typeof body.ai_polish === 'boolean') patch.ai_polish = body.ai_polish;

  // Full step replace. Guard: leads mid-flight past a removed step would break,
  // so replacing steps requires no active enrollments beyond the new length.
  if (body.steps) {
    const steps = body.steps.filter((s) => s.template_id);
    if (!steps.length) return NextResponse.json({ error: 'at least one step is required' }, { status: 400 });

    const { count: inFlight } = await supabaseAdmin
      .from('sequence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('sequence_id', id)
      .in('status', ['active', 'sending'])
      .gte('current_step', steps.length);
    if ((inFlight ?? 0) > 0) {
      return NextResponse.json(
        { error: `${inFlight} enrolled leads are already past step ${steps.length}; wait for them to finish or stop them first` },
        { status: 409 },
      );
    }

    const { error: delErr } = await supabaseAdmin.from('email_sequence_steps').delete().eq('sequence_id', id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error: insErr } = await supabaseAdmin.from('email_sequence_steps').insert(
      steps.map((s, i) => ({
        sequence_id: id,
        position: i,
        template_id: s.template_id!,
        wait_days: i === 0 ? 0 : Math.max(1, Math.floor(s.wait_days ?? 3)),
      })),
    );
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('email_sequences').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: seq } = await supabaseAdmin.from('email_sequences').select('*').eq('id', id).maybeSingle();
  return NextResponse.json({ sequence: seq });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const { count: active } = await supabaseAdmin
    .from('sequence_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', id)
    .in('status', ['active', 'sending']);
  if ((active ?? 0) > 0) {
    return NextResponse.json(
      { error: `${active} leads are still enrolled; pause or stop them first` },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin.from('email_sequences').update({ status: 'archived' }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
