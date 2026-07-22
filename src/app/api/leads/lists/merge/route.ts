import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Merge several lists into one new list. The companies (leads) are kept — only
// the list wrappers change. Membership rows for the sources are removed when the
// source lists are deleted (lead_list_members.list_id is ON DELETE CASCADE), and
// any running sequence keeps sending (sequence_enrollments.list_id is
// ON DELETE SET NULL, so deleting a source list never stops a campaign).
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { source_ids?: string[]; name?: string }
    | null;
  const sourceIds = [...new Set((body?.source_ids ?? []).filter(Boolean))];
  const name = body?.name?.trim();

  if (sourceIds.length < 2) {
    return NextResponse.json({ error: 'pick at least two lists to merge' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  // Every company that lives in any of the source lists.
  const { data: members, error: memErr } = await supabaseAdmin
    .from('lead_list_members')
    .select('lead_id')
    .in('list_id', sourceIds)
    .limit(20000);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const leadIds = [...new Set((members ?? []).map((m) => m.lead_id as string).filter(Boolean))];

  // Create the merged list.
  const { data: list, error: createErr } = await supabaseAdmin
    .from('lead_lists')
    .insert({ name: name.slice(0, 120) })
    .select('*')
    .single();
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

  // Copy the companies in (deduped by the unique (list_id, lead_id) constraint).
  if (leadIds.length) {
    const { error: addErr } = await supabaseAdmin
      .from('lead_list_members')
      .upsert(
        leadIds.map((lead_id) => ({ list_id: list.id as string, lead_id })),
        { onConflict: 'list_id,lead_id', ignoreDuplicates: true },
      );
    if (addErr) {
      // Roll back the half-made list so a retry starts clean.
      await supabaseAdmin.from('lead_lists').delete().eq('id', list.id);
      return NextResponse.json({ error: addErr.message }, { status: 500 });
    }
  }

  // Remove the now-merged source lists. Leads survive; only the wrappers go.
  const { error: delErr } = await supabaseAdmin
    .from('lead_lists')
    .delete()
    .in('id', sourceIds);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ list, merged: leadIds.length, from: sourceIds.length });
}
