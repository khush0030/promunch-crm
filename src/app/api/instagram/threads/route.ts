import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const CLASSES = ['collab', 'order', 'spam', 'unknown'];
const STAGES = ['new', 'in_convo', 'terms_sent', 'agreed', 'shipped', 'posted', 'declined'];

// Inbox tabs map to a classification filter; the collab tab uses the pipeline.
type Filterable = { eq: (col: string, val: string) => Filterable };
const TAB_FILTER: Record<string, <T extends Filterable>(q: T) => T> = {
  inbox: (q) => q, // everything, most recent first
  collab: (q) => q.eq('classification', 'collab') as typeof q,
  needs_human: (q) => q.eq('ticket_status', 'open') as typeof q,
  spam: (q) => q.eq('classification', 'spam') as typeof q,
};

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab') || 'inbox';
  const classification = searchParams.get('classification') || '';
  const stage = searchParams.get('stage') || '';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('ig_threads')
    .select('*', { count: 'exact' })
    .order('last_activity_at', { ascending: false })
    .range(offset, offset + limit - 1);

  query = (TAB_FILTER[tab] ?? TAB_FILTER.inbox)(query);
  if (classification && CLASSES.includes(classification)) query = query.eq('classification', classification);
  if (stage && STAGES.includes(stage)) query = query.eq('collab_stage', stage);
  if (q) query = query.or(`handle.ilike.%${q}%,full_name.ilike.%${q}%,last_message_snippet.ilike.%${q}%`);

  const [{ data: threads, count, error }, classCounts, stageCounts, settings] = await Promise.all([
    query,
    countBy('classification', CLASSES),
    countBy('collab_stage', STAGES),
    supabaseAdmin.from('ig_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: needsHuman } = await supabaseAdmin
    .from('ig_threads')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_status', 'open');

  return NextResponse.json({
    threads: threads ?? [],
    total: count ?? 0,
    page,
    limit,
    classCounts,
    stageCounts,
    needsHuman: needsHuman ?? 0,
    settings: settings.data ?? null,
  });
}

async function countBy(column: string, values: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    values.map(async (v) => {
      const { count } = await supabaseAdmin
        .from('ig_threads')
        .select('id', { count: 'exact', head: true })
        .eq(column, v);
      if (count) counts[v] = count;
    }),
  );
  return counts;
}
