import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listStatusCounts } from '@/lib/leads/db';
import { stageOf, type Stage } from '@/lib/leads/lead-status';

export const dynamic = 'force-dynamic';

// Lists index: one list per search (plus lists made from a selection), with
// per-stage counts from one grouped query.
export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const [{ data: lists, error }, counts, { data: searches }] = await Promise.all([
    supabaseAdmin
      .from('lead_lists')
      // Two FKs link lead_lists <-> lead_searches, so the embed must name the
      // source_search_id one explicitly.
      .select('id, name, description, source_search_id, archived, created_at, updated_at, lead_searches!lead_lists_source_search_id_fkey(category, city)')
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    listStatusCounts(null),
    supabaseAdmin.from('lead_searches').select('id, list_id, status').in('status', ['pending', 'running']),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agg = new Map<string, Record<Stage, number> & { total: number }>();
  for (const r of counts) {
    const a = agg.get(r.list_id) ?? ({ total: 0 } as Record<Stage, number> & { total: number });
    const st = stageOf(r.status);
    a[st] = (a[st] ?? 0) + r.n;
    a.total += r.n;
    agg.set(r.list_id, a);
  }
  const finding = new Set((searches ?? []).map((s) => s.list_id as string | null).filter(Boolean));

  return NextResponse.json({
    lists: (lists ?? []).map((l) => {
      const search = l.lead_searches as unknown as { category: string; city: string } | null;
      const { lead_searches: _drop, ...rest } = l as Record<string, unknown>;
      void _drop;
      const a = agg.get(l.id);
      return {
        ...rest,
        category: search?.category ?? null,
        city: search?.city ?? null,
        total: a?.total ?? 0,
        stages: a ?? {},
        finding: finding.has(l.id),
      };
    }),
  });
}

// Make a list from a selection ("Add to list" -> "New list").
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { name?: string; description?: string; lead_ids?: string[] } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const leadIds = Array.isArray(body?.lead_ids) ? body.lead_ids.map(String).filter(Boolean).slice(0, 2000) : [];
  if (!leadIds.length) return NextResponse.json({ error: 'Pick the businesses to put in the new list.' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('lead_lists')
    .insert({ name: name.slice(0, 120), description: body?.description?.trim() || null })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: memErr } = await supabaseAdmin
    .from('lead_list_members')
    .upsert(leadIds.map((lead_id) => ({ list_id: data.id as string, lead_id })), { onConflict: 'list_id,lead_id', ignoreDuplicates: true });
  if (memErr) {
    await supabaseAdmin.from('lead_lists').delete().eq('id', data.id);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  return NextResponse.json({ list: data, added: leadIds.length });
}
