import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const LEAD_STATUSES = [
  'new', 'crawling', 'ready', 'no_contacts', 'no_website', 'listed', 'drafting', 'drafted',
  'contacted', 'replied', 'bounced', 'suppressed',
];

// A lead only reaches these statuses once a verified (mx_ok) email was found,
// so they're an accurate proxy for "has a usable email".
const EMAIL_STATUSES = ['ready', 'drafting', 'drafted', 'contacted', 'replied', 'bounced'];

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
  const hasEmail = searchParams.get('hasEmail') === '1';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('leads')
    .select('*, lead_contacts(*), outreach_drafts(*), outreach_replies(*)', { count: 'exact' })
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (statuses.length) query = query.in('status', statuses);
  else if (status && LEAD_STATUSES.includes(status)) query = query.eq('status', status);
  // "Every lead must have an email" — restrict to email-bearing statuses.
  if (hasEmail) query = query.in('status', EMAIL_STATUSES);
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
        .select('id, category, city, status, pages_fetched, results_count, error, created_at, updated_at, products')
        .order('created_at', { ascending: false })
        .limit(100),
      countSentToday(),
      supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle(),
    ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Per-scrape count of email-bearing leads, so cards show "X with email".
  const emailBySearch = await emailLeadCountBySearch();
  const searchesOut = (searches.data ?? []).map((s) => ({
    ...s,
    email_count: emailBySearch[s.id as string] ?? 0,
  }));

  return NextResponse.json({
    leads: leads ?? [],
    total: count ?? 0,
    page,
    limit,
    statusCounts,
    searches: searchesOut,
    sentToday,
    settings: settings.data ?? null,
  });
}

// Tally email-bearing leads (email statuses) per search_id in one query.
async function emailLeadCountBySearch(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('search_id')
    .in('status', EMAIL_STATUSES)
    .not('search_id', 'is', null)
    .limit(10000);
  const map: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = r.search_id as string;
    map[k] = (map[k] ?? 0) + 1;
  }
  return map;
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
