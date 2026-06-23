import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const LEAD_STATUSES = [
  'new', 'crawling', 'ready', 'no_contacts', 'no_website', 'listed', 'drafting', 'drafted',
  'contacted', 'replied', 'bounced', 'suppressed',
];

export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || '';
  const statuses = (searchParams.get('statuses') || '')
    .split(',')
    .filter((s) => LEAD_STATUSES.includes(s));
  const city = searchParams.get('city') || '';
  const category = searchParams.get('category') || '';
  const searchId = searchParams.get('searchId') || '';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('leads')
    .select('*, lead_contacts(*), outreach_drafts(*)', { count: 'exact' })
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (statuses.length) query = query.in('status', statuses);
  else if (status && LEAD_STATUSES.includes(status)) query = query.eq('status', status);
  if (searchId) query = query.eq('search_id', searchId);
  if (city) query = query.eq('city', city);
  if (category) query = query.eq('category', category);
  if (q) query = query.or(`name.ilike.%${q}%,domain.ilike.%${q}%`);

  const [{ data: leads, count, error }, statusCounts, searches, sentToday, settings] =
    await Promise.all([
      query,
      countByStatus(),
      supabaseAdmin
        .from('lead_searches')
        .select('id, category, city, status, pages_fetched, results_count, error, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(100),
      countSentToday(),
      supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle(),
    ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    leads: leads ?? [],
    total: count ?? 0,
    page,
    limit,
    statusCounts,
    searches: searches.data ?? [],
    sentToday,
    settings: settings.data ?? null,
  });
}

async function countByStatus(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    LEAD_STATUSES.map(async (s) => {
      const { count } = await supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('status', s);
      if (count) counts[s] = count;
    }),
  );
  return counts;
}

async function countSentToday(): Promise<number> {
  // Day boundary in IST, where the recipient inboxes live.
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 3600_000;
  const istMidnightUtc = new Date(Math.floor(istMs / 86_400_000) * 86_400_000 - 5.5 * 3600_000);
  const { count } = await supabaseAdmin
    .from('outreach_drafts')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', istMidnightUtc.toISOString());
  return count ?? 0;
}
