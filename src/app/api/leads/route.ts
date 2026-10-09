import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ilikeContains } from '@/lib/inbox/search';
import { EMAIL_STATUSES, LEAD_STATUSES } from '@/lib/leads/lead-status';
import { countSentToday, leadStatusCounts } from '@/lib/leads/db';

export const dynamic = 'force-dynamic';

// Business rows for a filter (Replies, search). Counts and settings only when
// asked (?counts=1): the strip/polling reads the cheap /api/leads/status.
export async function GET(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || '';
  const statuses = (searchParams.get('statuses') || '')
    .split(',')
    .filter((s) => (LEAD_STATUSES as string[]).includes(s));
  const city = searchParams.get('city') || '';
  const category = searchParams.get('category') || '';
  const searchId = searchParams.get('searchId') || '';
  const hasEmail = searchParams.get('hasEmail') === '1';
  const q = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  const recentFirst = searchParams.get('order') === 'recent';
  let query = supabaseAdmin
    .from('leads')
    .select('*, lead_contacts(*), outreach_drafts(*), outreach_replies(*)', { count: 'exact' });
  query = recentFirst
    ? query.order('updated_at', { ascending: false })
    : query.order('fit_score', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false });
  query = query.range(offset, offset + limit - 1);

  if (statuses.length) query = query.in('status', statuses);
  else if (status && (LEAD_STATUSES as string[]).includes(status)) query = query.eq('status', status);
  // "Every lead must have an email" — restrict to email-bearing statuses.
  if (hasEmail) query = query.in('status', EMAIL_STATUSES);
  if (searchId) query = query.eq('search_id', searchId);
  if (city) query = query.eq('city', city);
  if (category) query = query.eq('category', category);
  if (q) {
    const like = ilikeContains(q);
    if (like) query = query.or(`name.ilike.${like},domain.ilike.${like}`);
  }

  const withCounts = searchParams.get('counts') === '1';
  const [{ data: leads, count, error }, statusCounts, sentToday, settings] = await Promise.all([
    query,
    withCounts ? leadStatusCounts() : Promise.resolve({} as Record<string, number>),
    withCounts ? countSentToday() : Promise.resolve(0),
    withCounts
      ? supabaseAdmin.from('outreach_settings').select('*').eq('id', 1).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    leads: leads ?? [],
    total: count ?? 0,
    page,
    limit,
    statusCounts,
    sentToday,
    settings,
  });
}
