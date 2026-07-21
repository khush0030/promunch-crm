import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sanitizeSearch } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

const STATUSES = ['new', 'shortlisted', 'contacted', 'in_convo', 'rejected'];
const SORTS: Record<string, { col: string; asc: boolean }> = {
  fit: { col: 'fit_score', asc: false },
  followers: { col: 'followers', asc: false },
  er: { col: 'engagement_rate', asc: false },
  recent: { col: 'created_at', asc: false },
};

// Discovered influencer prospects, filterable server-side (followers band,
// engagement rate, fit score, niche, has-email).
export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || '';
  const minFollowers = parseInt(searchParams.get('min_followers') || '');
  const maxFollowers = parseInt(searchParams.get('max_followers') || '');
  const minEr = parseFloat(searchParams.get('min_er') || '');       // percent, e.g. 2 = 2%
  const minFit = parseInt(searchParams.get('min_fit') || '');
  const niche = searchParams.get('niche') || '';
  const hasEmail = searchParams.get('has_email') === '1';
  const q = searchParams.get('q') || '';
  const sort = SORTS[searchParams.get('sort') || 'fit'] ?? SORTS.fit;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('ig_prospects')
    .select('*', { count: 'exact' })
    .order(sort.col, { ascending: sort.asc, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  if (Number.isFinite(minFollowers)) query = query.gte('followers', minFollowers);
  if (Number.isFinite(maxFollowers)) query = query.lte('followers', maxFollowers);
  if (Number.isFinite(minEr)) query = query.gte('engagement_rate', minEr / 100);
  if (Number.isFinite(minFit)) query = query.gte('fit_score', minFit);
  if (hasEmail) query = query.not('bio_email', 'is', null);
  if (niche) {
    const safe = sanitizeSearch(niche);
    if (safe) query = query.ilike('niche', `%${safe}%`);
  }
  if (q) {
    const safe = sanitizeSearch(q);
    if (safe) query = query.or(`handle.ilike.%${safe}%,full_name.ilike.%${safe}%,biography.ilike.%${safe}%`);
  }

  const { data: prospects, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statusCounts: Record<string, number> = {};
  await Promise.all(
    STATUSES.map(async (s) => {
      const { count: c } = await supabaseAdmin
        .from('ig_prospects')
        .select('id', { count: 'exact', head: true })
        .eq('status', s);
      statusCounts[s] = c ?? 0;
    }),
  );

  return NextResponse.json({ prospects: prospects ?? [], total: count ?? 0, page, limit, statusCounts });
}

// Manual handle intake: paste handles, they get enriched + scored like any
// discovered prospect.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const handles: string[] = (Array.isArray(body.handles) ? body.handles : [])
    .map((h: unknown) => String(h).replace(/^@/, '').trim().toLowerCase())
    .filter((h: string) => /^[a-z0-9._]{1,60}$/.test(h));
  if (!handles.length) return NextResponse.json({ error: 'handles required' }, { status: 400 });

  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ig-discovery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'enrich', handles }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
