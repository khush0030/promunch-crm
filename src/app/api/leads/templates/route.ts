import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const [{ data: templates, error }, { data: steps }] = await Promise.all([
    supabaseAdmin
      .from('email_templates')
      .select('*')
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('email_sequence_steps').select('template_id, sequence_id'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const usage = new Map<string, Set<string>>();
  for (const s of steps ?? []) {
    if (!usage.has(s.template_id)) usage.set(s.template_id, new Set());
    usage.get(s.template_id)!.add(s.sequence_id);
  }

  return NextResponse.json({
    templates: (templates ?? []).map((t) => ({ ...t, used_in_sequences: usage.get(t.id)?.size ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { name?: string; subject?: string; body_text?: string }
    | null;
  const name = body?.name?.trim();
  const subject = body?.subject?.trim();
  const bodyText = body?.body_text?.trim();
  if (!name || !subject || !bodyText) {
    return NextResponse.json({ error: 'name, subject and body_text are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('email_templates')
    .insert({ name: name.slice(0, 120), subject: subject.slice(0, 200), body_text: bodyText })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
