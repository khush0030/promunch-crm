import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// List detail: the list row + its member leads with everything the table
// shows (contact, fit, last contacted, sequence status).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const [{ data: list, error }, { data: members }, { data: enrollments }] = await Promise.all([
    supabaseAdmin.from('lead_lists').select('*').eq('id', id).maybeSingle(),
    supabaseAdmin
      .from('lead_list_members')
      .select('lead_id, added_at, leads(*, lead_contacts(*), outreach_drafts(id, subject, status, sent_at, step_position), outreach_replies(id, received_at))')
      .eq('list_id', id)
      .limit(2000),
    supabaseAdmin
      .from('sequence_enrollments')
      .select('lead_id, sequence_id, status, current_step, next_send_at, email_sequences(name)')
      .eq('list_id', id),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!list) return NextResponse.json({ error: 'list not found' }, { status: 404 });

  const enrollByLead = new Map((enrollments ?? []).map((e) => [e.lead_id, e]));

  const leads = (members ?? [])
    .map((m) => {
      const lead = m.leads as unknown as Record<string, unknown> | null;
      if (!lead) return null;
      const drafts = (lead.outreach_drafts as { sent_at: string | null }[] | null) ?? [];
      const lastContacted = drafts
        .map((d) => d.sent_at)
        .filter((s): s is string => !!s)
        .sort()
        .pop() ?? null;
      const e = enrollByLead.get(m.lead_id);
      return {
        ...lead,
        added_at: m.added_at,
        last_contacted_at: lastContacted,
        enrollment: e
          ? {
              status: e.status,
              current_step: e.current_step,
              next_send_at: e.next_send_at,
              sequence_name: (e.email_sequences as unknown as { name: string } | null)?.name ?? null,
            }
          : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ list, leads });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as
    | { name?: string; description?: string; archived?: boolean }
    | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (typeof body.description === 'string') patch.description = body.description.trim() || null;
  if (typeof body.archived === 'boolean') patch.archived = body.archived;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('lead_lists')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ list: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const { error } = await supabaseAdmin.from('lead_lists').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
