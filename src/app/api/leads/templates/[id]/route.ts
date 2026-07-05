import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as
    | { name?: string; subject?: string; body_text?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.name?.trim()) patch.name = body.name.trim().slice(0, 120);
  if (body.subject?.trim()) patch.subject = body.subject.trim().slice(0, 200);
  if (body.body_text?.trim()) patch.body_text = body.body_text.trim();
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

// Delete a template; if a sequence step references it, archive instead so
// running sequences keep working (foreign key would block the delete anyway).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const { count } = await supabaseAdmin
    .from('email_sequence_steps')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id);

  if ((count ?? 0) > 0) {
    const { error } = await supabaseAdmin.from('email_templates').update({ archived: true }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, archived: true, note: 'template is used by a sequence, archived instead of deleted' });
  }

  const { error } = await supabaseAdmin.from('email_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, archived: false });
}
